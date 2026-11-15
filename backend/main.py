
import os
import uuid
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException
import database
import models

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from health_analysis import (
    analyze_assessment,
    compare_with_previous,
    validate_measurements,
    evaluate_health_trend,
    compute_focus_areas,
    evaluate_all_time_trend,
    evaluate_period_trend,
    compute_all_period_trends,
    aggregate_assessments_by_day,
    build_today_submissions_breakdown,
    parse_assessment_datetime
)
import kaggle_ai
import support_database
import support_ai

app = FastAPI(
    title="ASTRO CODE BLUE API",
    description="Astronaut Health Monitoring Backend",
    version="1.0.0"
)

# Create database tables
models.Base.metadata.create_all(bind=database.engine)
# Create dedicated support database tables
support_database.init_support_db()

# One-time trigger to wipe database if clear_db.trigger exists
trigger_file = os.path.join(os.path.dirname(__file__), "clear_db.trigger")
if os.path.exists(trigger_file):
    try:
        with database.SessionLocal() as session:
            count = session.query(models.Assessment).delete()
            session.commit()
            print(f"Trigger executed: Cleared {count} records from astro_code_blue.db!")
        os.remove(trigger_file)
    except Exception as e:
        print(f"Error executing clear trigger: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Allowed measurement sources
MeasurementSource = Literal[
    "manual_entry",
    "self_reported",
    "device",
    "medical_test",
    "imported"
]


# 2. Individual measurement
class AssessmentMeasurement(BaseModel):
    value: str | int | float
    unit: str
    recordedAt: datetime
    source: MeasurementSource
    notes: str | None = None


# 3. Symptom information
class SymptomReport(BaseModel):
    symptom: str
    severity: Literal[
        "mild", "moderate", "severe", "unspecified"
    ]
    recordedAt: datetime
    source: Literal["self_reported"]
    notes: str | None = None


# 4. Vision and symptoms group
class VisionAndSymptoms(BaseModel):
    measurements: dict[str, AssessmentMeasurement]
    symptoms: list[SymptomReport]


# 5. All six assessment groups
class AssessmentGroups(BaseModel):
    sleepAndWellness: dict[str, AssessmentMeasurement]
    cognitiveHealth: dict[str, AssessmentMeasurement]
    visionAndSymptoms: VisionAndSymptoms
    vitalSigns: dict[str, AssessmentMeasurement]
    spaceEnvironment: dict[str, AssessmentMeasurement]
    specializedMedical: dict[str, AssessmentMeasurement]


# 6. Complete assessment record
class StructuredAssessmentRecord(BaseModel):
    schemaVersion: Literal[2]
    id: str
    assessmentDate: datetime
    submittedAt: datetime
    groups: AssessmentGroups
    assessmentNotes: str | None = None

# 7. Home endpoint
@app.get("/")
def home():
    return {
        "message": "Welcome to ASTRO CODE BLUE Backend!",
        "status": "Running successfully"
    }


@app.post("/assessments")
def create_or_update_assessment(
    record: StructuredAssessmentRecord,
    db: Session = Depends(database.get_db)
):
    # Convert the submitted assessment into a dictionary
    assessment_data = record.model_dump(mode="json")

    # Validate measurements BEFORE saving
    validation_issues = validate_measurements(assessment_data)

    if validation_issues:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Assessment contains invalid measurements.",
                "validation_issues": validation_issues
            }
        )

    # Normalize datetimes to naive datetime preserving given wall-clock time
    def to_naive_utc(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        return dt.replace(tzinfo=None)

    def is_same_minute(dt1: datetime | None, dt2: datetime | None) -> bool:
        if dt1 is None or dt2 is None:
            return False
        n1 = to_naive_utc(dt1)
        n2 = to_naive_utc(dt2)
        if n1 is None or n2 is None:
            return False
        return abs((n1 - n2).total_seconds()) < 60

    norm_assessment_date = to_naive_utc(record.assessmentDate)
    norm_submitted_at = to_naive_utc(record.submittedAt)

    # Check if this exact record ID is being edited (true correction/update).
    # NOTE: We NO LONGER match by timestamp — same-minute submissions are
    # treated as NEW accumulated sessions (sleep + water + exercise add up).
    existing_assessment = None

    # Match only by exact record ID
    by_id = db.query(models.Assessment).filter(models.Assessment.id == record.id).first()
    if by_id:
        existing_assessment = by_id

    is_override = existing_assessment is not None
    exclude_id = existing_assessment.id if existing_assessment else record.id

    target_day = norm_assessment_date.strftime("%Y-%m-%d") if norm_assessment_date else datetime.now().strftime("%Y-%m-%d")

    # Extract submitted increments
    raw_groups = record.groups.model_dump(mode="json")
    sw = raw_groups.get("sleepAndWellness", {})

    new_sleep = None
    s_val = sw.get("sleepDuration", {}).get("value")
    if s_val is not None and str(s_val).strip() != "":
        try:
            new_sleep = float(s_val)
        except ValueError:
            pass

    new_water = None
    w_val = sw.get("waterIntake", {}).get("value")
    if w_val is not None and str(w_val).strip() != "":
        try:
            new_water = float(w_val)
        except ValueError:
            pass

    new_exercise = None
    e_val = sw.get("exerciseDuration", {}).get("value")
    if e_val is not None and str(e_val).strip() != "":
        try:
            new_exercise = float(e_val)
        except ValueError:
            pass

    # Find prior assessments on this calendar day in DB (excluding current record being saved/updated)
    all_priors = db.query(models.Assessment).filter(models.Assessment.id != exclude_id).all()
    prior_today = [
        a for a in all_priors
        if a.assessmentDate and a.assessmentDate.strftime("%Y-%m-%d") == target_day
    ]
    prior_today.sort(key=lambda x: to_naive_utc(x.assessmentDate) or datetime.min)

    # Accumulate session increments from prior logs today
    prior_sleep = 0.0
    prior_water = 0.0
    prior_exercise = 0.0

    if prior_today:
        for p in prior_today:
            pg = p.groups if isinstance(p.groups, dict) else {}
            psw = pg.get("sleepAndWellness", {})

            # Sleep increment
            s_item = psw.get("sleepDuration", {})
            ps = s_item.get("session_increment") or s_item.get("raw_increment") or s_item.get("value")
            if ps is not None and str(ps).strip():
                try:
                    prior_sleep += float(ps)
                except ValueError:
                    pass

            # Water increment
            w_item = psw.get("waterIntake", {})
            pw = w_item.get("session_increment") or w_item.get("raw_increment") or w_item.get("value")
            if pw is not None and str(pw).strip():
                try:
                    prior_water += float(pw)
                except ValueError:
                    pass

            # Exercise increment
            e_item = psw.get("exerciseDuration", {})
            pe = e_item.get("session_increment") or e_item.get("raw_increment") or e_item.get("value")
            if pe is not None and str(pe).strip():
                try:
                    prior_exercise += float(pe)
                except ValueError:
                    pass

    # Calculate accumulated totals for today
    accumulated_sleep = round(prior_sleep + (new_sleep or 0.0), 2) if (new_sleep is not None or prior_sleep > 0) else None
    accumulated_water = round(prior_water + (new_water or 0.0), 2) if (new_water is not None or prior_water > 0) else None
    accumulated_exercise = round(prior_exercise + (new_exercise or 0.0), 1) if (new_exercise is not None or prior_exercise > 0) else None

    # Update or insert DailyCumulativeHealth table
    daily_row = db.query(models.DailyCumulativeHealth).filter(models.DailyCumulativeHealth.date == target_day).first()
    if not daily_row:
        daily_row = models.DailyCumulativeHealth(
            date=target_day,
            totalSleepDuration=accumulated_sleep or 0.0,
            totalWaterIntake=accumulated_water or 0.0,
            totalExerciseDuration=accumulated_exercise or 0.0,
            logCount=len(prior_today) + 1,
            lastUpdated=norm_assessment_date or datetime.now()
        )
        db.add(daily_row)
    else:
        if accumulated_sleep is not None:
            daily_row.totalSleepDuration = accumulated_sleep
        if accumulated_water is not None:
            daily_row.totalWaterIntake = accumulated_water
        if accumulated_exercise is not None:
            daily_row.totalExerciseDuration = accumulated_exercise
        daily_row.logCount = len(prior_today) + 1
        daily_row.lastUpdated = norm_assessment_date or datetime.now()

    # Store accumulated values in raw_groups so db_assessment has the full accumulated totals!
    if "sleepAndWellness" in raw_groups:
        c_sw = raw_groups["sleepAndWellness"]
        if "sleepDuration" in c_sw and accumulated_sleep is not None:
            c_sw["sleepDuration"]["session_increment"] = new_sleep
            c_sw["sleepDuration"]["raw_increment"] = new_sleep
            c_sw["sleepDuration"]["cumulative_total"] = accumulated_sleep
            c_sw["sleepDuration"]["value"] = accumulated_sleep
            if prior_sleep > 0:
                c_sw["sleepDuration"]["notes"] = f"Total sleep today: {accumulated_sleep} hrs ({prior_sleep}h previous + {new_sleep}h session)"
        if "waterIntake" in c_sw and accumulated_water is not None:
            c_sw["waterIntake"]["session_increment"] = new_water
            c_sw["waterIntake"]["raw_increment"] = new_water
            c_sw["waterIntake"]["cumulative_total"] = accumulated_water
            c_sw["waterIntake"]["value"] = accumulated_water
            if prior_water > 0:
                c_sw["waterIntake"]["notes"] = f"Total hydration today: {accumulated_water} L ({prior_water}L previous + {new_water}L session)"
        if "exerciseDuration" in c_sw and accumulated_exercise is not None:
            c_sw["exerciseDuration"]["session_increment"] = new_exercise
            c_sw["exerciseDuration"]["raw_increment"] = new_exercise
            c_sw["exerciseDuration"]["cumulative_total"] = accumulated_exercise
            c_sw["exerciseDuration"]["value"] = accumulated_exercise
            if prior_exercise > 0:
                c_sw["exerciseDuration"]["notes"] = f"Total exercise today: {accumulated_exercise} mins ({prior_exercise}m previous + {new_exercise}m session)"

    if is_override:
        # Override / update existing assessment record
        existing_assessment.groups = raw_groups
        existing_assessment.assessmentDate = norm_assessment_date
        existing_assessment.submittedAt = norm_submitted_at
        existing_assessment.assessmentNotes = record.assessmentNotes
        db_assessment = existing_assessment
    else:
        # Save as a distinct new record
        target_id = record.id
        # Ensure target_id does not collide with an existing assessment in DB
        if db.query(models.Assessment).filter(models.Assessment.id == target_id).first():
            target_id = str(uuid.uuid4())

        db_assessment = models.Assessment(
            id=target_id,
            assessmentDate=norm_assessment_date,
            submittedAt=norm_submitted_at,
            groups=raw_groups,
            assessmentNotes=record.assessmentNotes
        )
        db.add(db_assessment)

    db.commit()
    db.refresh(db_assessment)

    # Get the immediately preceding assessment by assessmentDate/submittedAt (e.g. morning log or yesterday's log)
    previous_assessment = (
        db.query(models.Assessment)
        .filter(models.Assessment.id != db_assessment.id)
        .filter(models.Assessment.assessmentDate <= db_assessment.assessmentDate)
        .order_by(
            models.Assessment.assessmentDate.desc(),
            models.Assessment.submittedAt.desc()
        )
        .first()
    )

    if not previous_assessment:
        previous_assessment = (
            db.query(models.Assessment)
            .filter(models.Assessment.id != db_assessment.id)
            .order_by(models.Assessment.submittedAt.desc())
            .first()
        )

    # Fetch all records to build history and aggregate today's cumulative totals
    all_historical = (
        db.query(models.Assessment)
        .order_by(models.Assessment.assessmentDate.asc(), models.Assessment.submittedAt.asc())
        .all()
    )
    historical_list = [
        {"id": a.id, "assessmentDate": a.assessmentDate, "submittedAt": a.submittedAt, "groups": a.groups}
        for a in all_historical
    ]

    target_day = norm_assessment_date.strftime("%Y-%m-%d") if norm_assessment_date else datetime.now().strftime("%Y-%m-%d")
    day_assessments = [
        a for a in historical_list
        if parse_assessment_datetime(a) and parse_assessment_datetime(a).strftime("%Y-%m-%d") == target_day
    ]
    if not day_assessments:
        day_assessments = [assessment_data]

    # Aggregate today's cumulative totals (accumulating sleep, water, exercise)
    today_consolidated = aggregate_assessments_by_day(day_assessments)
    effective_assessment = today_consolidated[-1] if today_consolidated else assessment_data

    # Build today's detailed session-by-session progression breakdown (1st report, 2nd submission, total...)
    today_breakdown = build_today_submissions_breakdown(day_assessments, target_day)

    # Analyse the effective assessment incorporating today's cumulative totals
    analysis = analyze_assessment(effective_assessment)
    analysis["today_submissions_breakdown"] = today_breakdown

    # Compare with the previous DAY's consolidated total (not a raw individual record).
    # This prevents "Sleep decreased from 9h to 1h" when the 1h is just the latest same-day session.
    historical_changes = []
    previous_data = None

    if previous_assessment:
        prev_day = None
        if previous_assessment.assessmentDate:
            try:
                prev_day = to_naive_utc(previous_assessment.assessmentDate).strftime("%Y-%m-%d")
            except Exception:
                pass

        if prev_day and prev_day != target_day:
            # Build the full day-total for the previous calendar day
            prev_day_records = [
                a for a in historical_list
                if parse_assessment_datetime(a) and parse_assessment_datetime(a).strftime("%Y-%m-%d") == prev_day
            ]
            if prev_day_records:
                prev_consolidated = aggregate_assessments_by_day(prev_day_records)
                prev_data_consolidated = prev_consolidated[-1] if prev_consolidated else {"id": previous_assessment.id, "groups": previous_assessment.groups}
                previous_data = prev_data_consolidated
            else:
                previous_data = {"id": previous_assessment.id, "groups": previous_assessment.groups}

            historical_changes = compare_with_previous(effective_assessment, previous_data)
        else:
            # Same-day previous record — no cross-day comparison to show
            previous_data = {"id": previous_assessment.id, "groups": previous_assessment.groups}

    analysis["historical_changes"] = historical_changes
    analysis["focus_areas"] = compute_focus_areas(effective_assessment, analysis.get("insights", []), validation_issues, analysis.get("section_statuses", {}))

    # Compute multi-period trends (24h, 7d, 30d, all)
    period_trends = compute_all_period_trends(historical_list)
    analysis["period_trends"] = period_trends
    analysis["trend_evaluation"] = period_trends.get("24h")
    analysis["all_time_evaluation"] = period_trends.get("all")

    # Query Kaggle AI model if connected with the exact multi-submission progression
    ai_result = kaggle_ai.analyze_with_kaggle(
        effective_assessment,
        previous_data,
        today_breakdown=today_breakdown
    )
    if ai_result:
        print("[Kaggle AI] Successfully received live GPU evaluation from Qwen 2.5!")
        analysis["ai_status"] = "connected"
        analysis["ai_engine"] = "Qwen/Qwen2.5-7B-Instruct (Kaggle GPU Live)"
        analysis["overall_health_status"] = ai_result.get("overall_health_status", analysis.get("overall_health_status", "Nominal"))
        analysis["overall_summary"] = ai_result.get("overall_summary", analysis.get("overall_summary", ""))
        analysis["medical_alert"] = ai_result.get("medical_alert", analysis.get("medical_alert", {}))
        analysis["section_statuses"] = ai_result.get("section_statuses", analysis.get("section_statuses", {}))
        ai_ex = ai_result.get("exercises", [])
        if isinstance(ai_ex, list) and len(ai_ex) >= 5:
            analysis["exercises"] = ai_ex
        elif isinstance(ai_ex, list) and len(ai_ex) > 0:
            merged_ex = list(ai_ex)
            for ex in analysis.get("exercises", []):
                if len(merged_ex) >= 5:
                    break
                if not any(e.get("name") == ex.get("name") for e in merged_ex):
                    merged_ex.append(ex)
            analysis["exercises"] = merged_ex
        else:
            analysis["exercises"] = analysis.get("exercises", [])
        analysis["healthcare_suggestions"] = ai_result.get("healthcare_suggestions", analysis.get("healthcare_suggestions", []))
        if "trend_evaluation" in ai_result and ai_result["trend_evaluation"]:
            analysis["trend_evaluation"] = ai_result["trend_evaluation"]
        if "focus_areas" in ai_result and ai_result["focus_areas"]:
            analysis["focus_areas"] = ai_result["focus_areas"]
        if "overall_summary" in ai_result and ai_result["overall_summary"]:
            analysis["overall_summary"] = ai_result["overall_summary"]
        # Use AI-generated insights array if provided; otherwise prepend summary to local insights
        if "insights" in ai_result and isinstance(ai_result["insights"], list) and len(ai_result["insights"]) > 0:
            analysis["insights"] = ai_result["insights"]
        elif "overall_summary" in ai_result and ai_result["overall_summary"]:
            if "insights" in analysis and isinstance(analysis["insights"], list):
                analysis["insights"].insert(0, f"AI Clinical Summary: {ai_result['overall_summary']}")
        if "historical_changes" in ai_result and isinstance(ai_result["historical_changes"], list) and len(ai_result["historical_changes"]) > 0:
            analysis["historical_changes"] = ai_result["historical_changes"]
    else:
        print("[Kaggle AI] Offline or unreachable. Using NASA HRP Flight Surgeon Protocol local fallback.")
        analysis["ai_status"] = "fallback"
        analysis["ai_engine"] = "NASA HRP Flight Surgeon Protocol Engine (Local Fallback)"

    # Save analysis results in the database
    db_assessment.analysis = analysis
    db.commit()
    db.refresh(db_assessment)

    return {
        "message": "Assessment overridden and updated in database!" if is_override else "Assessment saved successfully!",
        "assessment_id": db_assessment.id,
        "is_override": is_override,
        "status": "success",
        "analysis": analysis
    }


@app.delete("/assessments")
@app.post("/api/clear-assessments")
def clear_all_assessments(db: Session = Depends(database.get_db)):
    deleted = db.query(models.Assessment).delete()
    deleted_cum = db.query(models.DailyCumulativeHealth).delete()
    db.commit()
    return {
        "message": f"Successfully deleted all {deleted} assessment records and {deleted_cum} cumulative records. Database is now empty and fresh.",
        "deleted_count": deleted,
        "status": "cleared"
    }


@app.get("/assessments/today")
def get_today_assessment(date: str | None = None, db: Session = Depends(database.get_db)):
    target_str = date or datetime.now().strftime("%Y-%m-%d")
    all_records = (
        db.query(models.Assessment)
        .order_by(models.Assessment.assessmentDate.desc(), models.Assessment.submittedAt.desc())
        .all()
    )
    today_records = [
        item for item in all_records
        if item.assessmentDate and item.assessmentDate.strftime("%Y-%m-%d") == target_str
    ]

    daily_row = db.query(models.DailyCumulativeHealth).filter(models.DailyCumulativeHealth.date == target_str).first()
    daily_cum = {
        "date": target_str,
        "totalSleepDuration": daily_row.totalSleepDuration if daily_row else 0.0,
        "totalWaterIntake": daily_row.totalWaterIntake if daily_row else 0.0,
        "totalExerciseDuration": daily_row.totalExerciseDuration if daily_row else 0.0,
        "logCount": len(today_records)
    } if (daily_row or today_records) else None

    if today_records:
        item = today_records[0]  # latest record of today
        return {
            "exists": True,
            "daily_cumulative": daily_cum,
            "log_count": len(today_records),
            "assessment": {
                "schemaVersion": 2,
                "id": item.id,
                "assessmentDate": item.assessmentDate,
                "submittedAt": item.submittedAt,
                "groups": item.groups,
                "assessmentNotes": item.assessmentNotes,
                "analysis": item.analysis
            }
        }
    return {"exists": False, "assessment": None, "daily_cumulative": None}


@app.get("/api/daily-cumulative")
def get_all_daily_cumulative(db: Session = Depends(database.get_db)):
    rows = db.query(models.DailyCumulativeHealth).order_by(models.DailyCumulativeHealth.date.asc()).all()
    return [
        {
            "date": r.date,
            "totalSleepDuration": r.totalSleepDuration,
            "totalWaterIntake": r.totalWaterIntake,
            "totalExerciseDuration": r.totalExerciseDuration,
            "logCount": r.logCount,
            "lastUpdated": r.lastUpdated
        }
        for r in rows
    ]


@app.post("/api/set-kaggle-url")
def set_kaggle_url(payload: dict):
    url = payload.get("url", "").strip()
    kaggle_ai.set_kaggle_url(url)
    return {
        "message": f"Kaggle AI URL set to {url}" if url else "Kaggle AI URL cleared",
        "url": url,
        "status": "configured" if url else "unconfigured"
    }


@app.get("/api/kaggle-status")
def get_kaggle_status():
    curr_url = kaggle_ai.get_kaggle_url()
    return {
        "url": curr_url,
        "is_configured": bool(curr_url)
    }


@app.get("/assessments")
def get_assessments(db: Session = Depends(database.get_db)):
    assessments = db.query(models.Assessment).all()
    results = []
    has_updates = False

    for assessment in assessments:
        analysis = assessment.analysis
        # Backfill analysis for any database records that lack full evaluation or complete 5-pillar countermeasure suite
        if not analysis or "medical_alert" not in analysis or "exercises" not in analysis or len(analysis.get("exercises", [])) < 5:
            analysis = analyze_assessment({
                "id": assessment.id,
                "groups": assessment.groups
            })
            assessment.analysis = analysis
            has_updates = True

        results.append({
            "schemaVersion": 2,
            "id": assessment.id,
            "assessmentDate": assessment.assessmentDate,
            "submittedAt": assessment.submittedAt,
            "groups": assessment.groups,
            "assessmentNotes": assessment.assessmentNotes,
            "analysis": analysis
        })

    if has_updates:
        try:
            db.commit()
        except Exception:
            db.rollback()

    return results


@app.get("/assessments/latest")
def get_latest_assessment(db: Session = Depends(database.get_db)):
    assessment = (
        db.query(models.Assessment)
        .order_by(models.Assessment.submittedAt.desc(), models.Assessment.id.desc())
        .first()
    )
    if not assessment:
        return {"assessment": None}

    analysis = assessment.analysis
    if not analysis or "medical_alert" not in analysis or "exercises" not in analysis or len(analysis.get("exercises", [])) < 5:
        analysis = analyze_assessment({
            "id": assessment.id,
            "groups": assessment.groups
        })
        assessment.analysis = analysis
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "assessment": {
            "schemaVersion": 2,
            "id": assessment.id,
            "assessmentDate": assessment.assessmentDate,
            "submittedAt": assessment.submittedAt,
            "groups": assessment.groups,
            "assessmentNotes": assessment.assessmentNotes,
            "analysis": analysis
        }
    }


@app.get("/api/trends/periods")
def get_period_trends(period: str | None = None, db: Session = Depends(database.get_db)):
    """
    Evaluates multi-period trend trajectories (24h, 7d, 30d, all).
    When Kaggle is online, Qwen 2.5 writes the clinical narrative summaries and
    direction_labels. Falls back to the local rule-engine text when offline.
    """
    all_historical = (
        db.query(models.Assessment)
        .order_by(models.Assessment.assessmentDate.asc(), models.Assessment.submittedAt.asc())
        .all()
    )
    historical_list = [
        {
            "id": a.id,
            "assessmentDate": a.assessmentDate,
            "submittedAt": a.submittedAt,
            "groups": a.groups,
            "assessmentNotes": a.assessmentNotes,
            "analysis": a.analysis
        }
        for a in all_historical
    ]
    # Local rule-engine computes numeric data (net_improvement_percent, metric_comparisons, direction)
    all_trends = compute_all_period_trends(historical_list)

    # Ask Kaggle to overwrite the narrative text (summary + direction_label) for each period
    ai_trends = kaggle_ai.analyze_trends_with_kaggle(all_trends, historical_list)
    if ai_trends and isinstance(ai_trends, dict):
        for p_key in ("24h", "7d", "30d", "all"):
            ai_p = ai_trends.get(p_key)
            if not isinstance(ai_p, dict):
                continue
            if p_key in all_trends:
                if ai_p.get("summary"):
                    all_trends[p_key]["summary"] = ai_p["summary"]
                    all_trends[p_key]["ai_narrative"] = True
                if ai_p.get("direction_label"):
                    all_trends[p_key]["direction_label"] = ai_p["direction_label"]
        # Surface the cross-period overview card at the top level
        if ai_trends.get("overview"):
            all_trends["ai_overview"] = ai_trends["overview"]
            all_trends["ai_overview_source"] = "Qwen/Qwen2.5-7B-Instruct (Kaggle GPU)"
        print("[Kaggle AI] Trend narratives injected for all periods.")
    else:
        print("[Kaggle AI] Trend narrative offline — using local rule-engine text.")

    if period and period in all_trends:
        return all_trends[period]
    return all_trends


@app.get("/api/trends/all-time")
def get_all_time_trends(db: Session = Depends(database.get_db)):
    """
    Evaluates the all-time mission trend trajectory by sending all historical telemetry
    (today, yesterday, and prior logs) to the clinical analytics engine.
    """
    all_historical = (
        db.query(models.Assessment)
        .order_by(models.Assessment.assessmentDate.asc(), models.Assessment.submittedAt.asc())
        .all()
    )
    historical_list = [
        {
            "id": a.id,
            "assessmentDate": a.assessmentDate,
            "submittedAt": a.submittedAt,
            "groups": a.groups,
            "assessmentNotes": a.assessmentNotes,
            "analysis": a.analysis
        }
        for a in all_historical
    ]
    return evaluate_all_time_trend(historical_list)


# ==============================================================================
# HELP & SUPPORT / AI TELE-TRIAGE CHAT (Dedicated Database: astro_support.db)
# ==============================================================================

class SupportChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    astronaut_id: str = "ACB-014"


class SupportEndSessionRequest(BaseModel):
    session_id: str


@app.post("/api/support/sessions/new")
def create_support_session(
    astronaut_id: str = "ACB-014",
    db: Session = Depends(support_database.get_support_db)
):
    """
    Creates a new AI Tele-Triage support chat session stored in astro_support.db.
    """
    now = datetime.now()
    session_id = f"SES-{uuid.uuid4().hex[:8].upper()}"
    welcome_msg = {
        "id": f"msg-{uuid.uuid4().hex[:6]}",
        "sender": "ai",
        "text": (
            "Greetings Astronaut ACB-014. I am the ASTRO CODE BLUE Clinical Support & Medical Triage Assistant.\n\n"
            "I continuously evaluate your health telemetry and symptoms. How can I assist you with your physiological status or mission wellness today?\n\n"
            "*(If an acute medical emergency is detected, an immediate uplink to the Ground Flight Surgeon Support Team will be established.)*"
        ),
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "isEscalation": False,
        "escalationReason": None,
        "escalationLink": None
    }
    
    new_session = support_database.SupportChatSession(
        session_id=session_id,
        astronaut_id=astronaut_id,
        created_at=now,
        status="ACTIVE",
        chief_complaint="General In-Flight Consultation",
        triage_level="ROUTINE",
        escalated=False,
        messages=[welcome_msg]
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session


@app.get("/api/support/sessions")
def list_support_sessions(db: Session = Depends(support_database.get_support_db)):
    """
    Lists all past and active support chat sessions from astro_support.db.
    """
    return (
        db.query(support_database.SupportChatSession)
        .order_by(support_database.SupportChatSession.created_at.desc())
        .all()
    )


@app.get("/api/support/sessions/{session_id}")
def get_support_session(session_id: str, db: Session = Depends(support_database.get_support_db)):
    """
    Retrieves a specific support session and transcript from astro_support.db.
    """
    session = (
        db.query(support_database.SupportChatSession)
        .filter(support_database.SupportChatSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Support session not found")
    return session


@app.post("/api/support/chat")
def handle_support_chat(
    req: SupportChatRequest,
    db: Session = Depends(support_database.get_support_db)
):
    """
    Processes a chat message with the Medical AI Assistant:
    - Analyzes message for acute medical conditions requiring Ground Support escalation.
    - If medical emergency/escalation is identified, generates escalation alert with link: www.google.com.
    - Appends message log and updates status with local timestamp in astro_support.db.
    """
    now = datetime.now()
    session = None
    if req.session_id:
        session = (
            db.query(support_database.SupportChatSession)
            .filter(support_database.SupportChatSession.session_id == req.session_id)
            .first()
        )
    
    # Auto-create session if none found
    if not session:
        session_id = req.session_id or f"SES-{uuid.uuid4().hex[:8].upper()}"
        session = support_database.SupportChatSession(
            session_id=session_id,
            astronaut_id=req.astronaut_id,
            created_at=now,
            status="ACTIVE",
            chief_complaint=req.message[:50],
            triage_level="ROUTINE",
            escalated=False,
            messages=[]
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    msgs = list(session.messages or [])
    
    # User message
    user_msg_id = f"msg-{uuid.uuid4().hex[:6]}"
    user_msg = {
        "id": user_msg_id,
        "sender": "user",
        "text": req.message,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "isEscalation": False
    }
    msgs.append(user_msg)

    # Generate AI response and clinical evaluation
    ai_eval = support_ai.generate_support_chat_reply(req.message, msgs)

    # If first user message, set chief complaint
    if session.chief_complaint == "General In-Flight Consultation":
        session.chief_complaint = req.message[:50]

    if ai_eval["is_escalated"]:
        session.escalated = True
        session.triage_level = ai_eval["triage_level"]
        session.escalation_reason = ai_eval["escalation_reason"]
    elif ai_eval["triage_level"] == "ELEVATED" and session.triage_level != "CRITICAL":
        session.triage_level = "ELEVATED"

    # AI message
    ai_msg_id = f"msg-{uuid.uuid4().hex[:6]}"
    ai_msg = {
        "id": ai_msg_id,
        "sender": "ai",
        "text": ai_eval["reply"],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "isEscalation": ai_eval["is_escalated"],
        "escalationReason": ai_eval["escalation_reason"],
        "escalationLink": ai_eval["escalation_link"]
    }
    msgs.append(ai_msg)

    session.messages = msgs
    db.commit()
    db.refresh(session)

    return {
        "session_id": session.session_id,
        "reply": ai_eval["reply"],
        "is_escalated": ai_eval["is_escalated"],
        "triage_level": session.triage_level,
        "escalation_reason": ai_eval["escalation_reason"],
        "escalation_link": ai_eval["escalation_link"],
        "timestamp": ai_msg["timestamp"],
        "session": session
    }


@app.post("/api/support/sessions/end")
def end_support_session(
    req: SupportEndSessionRequest,
    db: Session = Depends(support_database.get_support_db)
):
    """
    Ends a support chat session:
    - Generates a clinical triage summary and key recommendations.
    - Saves the summary with timestamp into astro_support.db.
    """
    session = (
        db.query(support_database.SupportChatSession)
        .filter(support_database.SupportChatSession.session_id == req.session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Support session not found")

    now = datetime.now()
    session.ended_at = now
    session.status = "ENDED"

    summary_data = support_ai.generate_session_summary(session.messages or [])
    session.summary = summary_data["summary"]
    session.key_recommendations = summary_data["key_recommendations"]
    if summary_data["escalated"]:
        session.escalated = True
        session.triage_level = summary_data["triage_level"]
        session.escalation_reason = summary_data["escalation_reason"]
    elif summary_data["triage_level"] == "ELEVATED" and session.triage_level != "CRITICAL":
        session.triage_level = "ELEVATED"

    # Add a closing system message to the chat transcript
    msgs = list(session.messages or [])
    msgs.append({
        "id": f"msg-{uuid.uuid4().hex[:6]}",
        "sender": "system",
        "text": f"Session concluded and clinical summary filed to Mission Tele-Triage Database at {now.strftime('%Y-%m-%d %H:%M:%S')}.",
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "isEscalation": False
    })
    session.messages = msgs

    db.commit()
    db.refresh(session)

    return {
        "message": "Session closed and summary filed successfully",
        "session": session,
        "summary": summary_data
    }


@app.delete("/api/support/sessions/{session_id}")
def delete_support_session(session_id: str, db: Session = Depends(support_database.get_support_db)):
    """
    Deletes a specific support chat session from astro_support.db.
    """
    session = (
        db.query(support_database.SupportChatSession)
        .filter(support_database.SupportChatSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Support session not found")
    db.delete(session)
    db.commit()
    return {"message": f"Session {session_id} deleted"}


@app.delete("/api/support/sessions")
def clear_all_support_sessions(db: Session = Depends(support_database.get_support_db)):
    """
    Clears all support sessions from astro_support.db.
    """
    count = db.query(support_database.SupportChatSession).delete()
    db.commit()
    return {"message": f"Cleared {count} support sessions from astro_support.db"}

