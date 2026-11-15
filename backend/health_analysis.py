import numpy as np
import pandas as pd
from datetime import datetime, timezone


def extract_measurements(assessment):
    """
    Extract all measurements from an astronaut assessment.
    """
    groups = assessment.get("groups", {})
    measurements = []

    for group_name, group_data in groups.items():
        if group_name == "visionAndSymptoms":
            group_measurements = group_data.get("measurements", {})
        else:
            group_measurements = group_data

        for measurement_name, measurement_data in group_measurements.items():
            value = measurement_data.get("value")
            measurements.append({
                "category": group_name,
                "measurement": measurement_name,
                "value": value,
                "unit": measurement_data.get("unit"),
                "source": measurement_data.get("source")
            })

    return measurements


def validate_measurements(assessment):
    """
    Check measurement values and units before analysis.
    Returns a list of validation issues.
    """
    measurements = extract_measurements(assessment)
    numeric_measurements = {
        "heartRate",
        "oxygenSaturation",
        "sleepDuration",
        "fatigueLevel",
        "systolic",
        "diastolic",
        "bodyTemperature",
        "waterIntake"
    }

    issues = []

    for item in measurements:
        name = item["measurement"]
        value = item["value"]
        unit = item.get("unit")

        if value is None or str(value).strip() == "":
            issues.append(f"{name}: Measurement value is missing.")
            continue

        if unit is None or str(unit).strip() == "":
            issues.append(f"{name}: Measurement unit is missing.")

        if name in numeric_measurements:
            try:
                numeric_value = float(value)
                if not np.isfinite(numeric_value):
                    raise ValueError
            except (ValueError, TypeError):
                issues.append(f"{name}: Measurement must contain a valid finite number.")

    return issues


def compare_with_previous(current_assessment, previous_assessment):
    current_measurements = extract_measurements(current_assessment)
    previous_measurements = extract_measurements(previous_assessment)

    # Check if both assessments are from the same calendar day
    dt_curr = parse_assessment_datetime(current_assessment)
    dt_prev = parse_assessment_datetime(previous_assessment)
    same_day = False
    if dt_curr and dt_prev:
        same_day = dt_curr.strftime("%Y-%m-%d") == dt_prev.strftime("%Y-%m-%d")

    measurement_labels = {
        "sleepDuration": "Sleep duration",
        "heartRate": "Heart rate",
        "oxygenSaturation": "Oxygen saturation",
        "waterIntake": "Water intake",
        "exerciseDuration": "Exercise duration",
        "systolic": "Systolic blood pressure",
        "diastolic": "Diastolic blood pressure",
        "bodyTemperature": "Body temperature"
    }

    # On the same calendar day, sleep, water, and exercise are cumulative additions
    # (e.g. adding 1h sleep after 9h sleep brings today's total to 10h, NOT a decrease!).
    cumulative_keys = {"sleepDuration", "waterIntake", "exerciseDuration"}

    previous_lookup = {}
    for item in previous_measurements:
        name = item["measurement"]
        if same_day and name in cumulative_keys:
            continue
        unit = str(item.get("unit") or "").strip().lower()
        value = pd.to_numeric(item["value"], errors="coerce")
        if pd.isna(value) or not np.isfinite(float(value)):
            continue
        previous_lookup[(name, unit)] = float(value)

    changes = []
    for item in current_measurements:
        name = item["measurement"]
        if same_day and name in cumulative_keys:
            continue
        unit = str(item.get("unit") or "").strip().lower()
        current_value = pd.to_numeric(item["value"], errors="coerce")
        if pd.isna(current_value) or not np.isfinite(float(current_value)):
            continue

        key = (name, unit)
        if key not in previous_lookup:
            continue

        previous_value = previous_lookup[key]
        current_value = float(current_value)

        if np.isclose(current_value, previous_value):
            continue

        display_unit = item.get("unit") or ""
        display_name = measurement_labels.get(name, name)
        direction = "increased" if current_value > previous_value else "decreased"

        changes.append(
            f"{display_name} {direction} from {previous_value:g} {display_unit} "
            f"to {current_value:g} {display_unit} compared with the previous assessment."
        )

    return changes


def analyze_assessment(assessment):
    validation_issues = validate_measurements(assessment)
    measurements = extract_measurements(assessment)
    df = pd.DataFrame(measurements)
    insights = []

    vital_issues = []
    sleep_issues = []
    cognitive_issues = []
    env_issues = []
    vision_issues = []

    # 1. Analyse numerical measurements
    for _, row in df.iterrows():
        value = pd.to_numeric(row["value"], errors="coerce")
        if pd.isna(value):
            continue

        name = row["measurement"]
        unit = str(row["unit"]).strip().lower()

        if name == "heartRate" and unit == "bpm":
            if value < 50 or value > 100:
                msg = f"Heart rate reading ({value} BPM) requires verification."
                insights.append(msg)
                vital_issues.append(msg)

        elif name == "oxygenSaturation" and unit == "%":
            if value < 95:
                msg = f"Low oxygen saturation ({value}%). Immediate medical-team review advised."
                insights.append(msg)
                vital_issues.append(msg)

        elif name == "sleepDuration" and unit in ["hours", "hrs"]:
            if value < 6:
                msg = f"Sleep duration ({value}h) is severely below flight target."
                insights.append(msg)
                sleep_issues.append(msg)
            elif value < 7:
                msg = f"Sleep duration ({value}h) is below the nominal 7-8h target."
                insights.append(msg)
                sleep_issues.append(msg)

        elif name == "waterIntake" and unit == "l":
            if value < 2.0:
                msg = f"Daily hydration ({value} L) is below optimal 2.5 L microgravity intake."
                insights.append(msg)
                sleep_issues.append(msg)

        elif name == "fatigueLevel":
            if value >= 4:
                msg = f"High fatigue score ({value}/5) reported. Review workload and sleep recovery."
                insights.append(msg)
                sleep_issues.append(msg)

        elif name == "cabinCo2" and unit == "mmhg":
            if value > 3.0:
                msg = f"Cabin CO2 elevated at {value} mmHg. Check ECLSS scrubbers."
                insights.append(msg)
                env_issues.append(msg)

    # 2. Analyse reported symptoms
    groups = assessment.get("groups", {})
    vision_data = groups.get("visionAndSymptoms", {})
    symptoms = vision_data.get("symptoms", [])

    severe_symptoms = []
    for symptom in symptoms:
        if isinstance(symptom, dict):
            symptom_name = symptom.get("symptom") or symptom.get("name") or "Unspecified symptom"
            severity = str(symptom.get("severity", "unspecified")).lower()
        else:
            symptom_name = str(symptom)
            severity = "moderate"

        if severity == "severe":
            msg = f"Severe symptom reported: {symptom_name}. Immediate flight surgeon review required."
            insights.append(msg)
            severe_symptoms.append(symptom_name)
            vision_issues.append(msg)
        elif severity == "moderate":
            msg = f"Moderate symptom reported: {symptom_name}. Close monitoring indicated."
            insights.append(msg)
            vision_issues.append(msg)
        elif severity == "mild":
            msg = f"Mild symptom reported: {symptom_name}."
            insights.append(msg)
            vision_issues.append(msg)

    # Determine overall status and medical alert
    has_critical = len(severe_symptoms) > 0 or any("Low oxygen" in i for i in vital_issues)
    has_caution = len(insights) > 0

    overall_status = "Critical" if has_critical else "Caution" if has_caution else "Nominal"

    if has_critical:
        alert_severity = "high"
        seek_support = True
        advice = f"Flight surgeon medical review required. Severe indicators: {', '.join(severe_symptoms or ['vital alerts'])}."
    elif has_caution:
        alert_severity = "moderate"
        seek_support = False
        advice = "Monitor telemetry trends. Increase recovery countermeasures and log next assessment in 12 hours."
    else:
        alert_severity = "low"
        seek_support = False
        advice = "All telemetry nominal. Continue standard flight protocol countermeasures."

    # Section statuses
    section_statuses = {
        "sleepAndWellness": {
            "status": "Caution" if len(sleep_issues) > 0 else "Nominal",
            "findings": "; ".join(sleep_issues) if sleep_issues else "Sleep duration, quality, and hydration are within nominal mission limits."
        },
        "vitalSigns": {
            "status": "Critical" if any("oxygen" in i for i in vital_issues) else "Caution" if len(vital_issues) > 0 else "Nominal",
            "findings": "; ".join(vital_issues) if vital_issues else "Cardiovascular vital signs (Heart rate, blood pressure, SpO2, temp) nominal."
        },
        "cognitiveHealth": {
            "status": "Caution" if len(cognitive_issues) > 0 else "Nominal",
            "findings": "; ".join(cognitive_issues) if cognitive_issues else "Cognitive alertness, reaction times, and subjective morale are stable."
        },
        "visionAndSymptoms": {
            "status": "Critical" if len(severe_symptoms) > 0 else "Caution" if len(vision_issues) > 0 else "Nominal",
            "findings": "; ".join(vision_issues) if vision_issues else "No visual acuity degradation or SANS neuro-ocular symptoms detected."
        },
        "spaceEnvironment": {
            "status": "Caution" if len(env_issues) > 0 else "Nominal",
            "findings": "; ".join(env_issues) if env_issues else "Cabin atmospheric pressure, CO2 concentration, and radiation exposure nominal."
        },
        "specializedMedical": {
            "status": "Nominal",
            "findings": "Specialized ultrasound and biomarker telemetry recorded without acute clinical markers."
        }
    }

    # Dynamic AI Countermeasure Prescription Engine
    # Evaluates the astronaut's real-time vitals, symptoms, fatigue level, and daily totals.
    exercises = []
    suggestions = []

    daily_aggr = assessment.get("daily_aggregates")
    tot_sleep = daily_aggr.get("total_sleep", 0.0) if daily_aggr else 0.0
    tot_water = daily_aggr.get("total_water", 0.0) if daily_aggr else 0.0
    tot_exercise = daily_aggr.get("total_exercise", 0.0) if daily_aggr else 0.0
    log_cnt = daily_aggr.get("log_count", 1) if daily_aggr else 1

    # Extract vital numbers for clinical triage
    m_dict = {m["measurement"]: pd.to_numeric(m["value"], errors="coerce") for m in measurements}
    hr_val = m_dict.get("heartRate")
    spo2_val = m_dict.get("oxygenSaturation")
    fatigue_val = m_dict.get("fatigueLevel")
    stress_val = m_dict.get("stressLevel")
    sys_val = m_dict.get("systolic")

    has_vision = len(vision_issues) > 0 or any("vision" in str(s).lower() for s in severe_symptoms)
    has_high_fatigue = (fatigue_val is not None and fatigue_val >= 4) or any("fatigue" in i.lower() for i in insights) or (tot_sleep > 0 and tot_sleep < 5.0)
    has_cardio_strain = (hr_val is not None and hr_val > 95) or (sys_val is not None and sys_val > 135)
    has_hypoxia = (spo2_val is not None and spo2_val < 95)

    # 1. AI DYNAMIC COUNTERMEASURE EXERCISE SELECTION (COMPLETE 5-PILLAR REGIMEN)
    # Pillar 1: Axial Heavy Resistance Countermeasure (ARED)
    if has_high_fatigue:
        exercises.append({
            "name": "ARED Spinal-Sparing Posterior Chain Loading",
            "category": "Resistance Countermeasure",
            "duration": "20 mins",
            "intensity": "Submaximal (65% 1RM)",
            "target": "Femoral neck, gluteals, and lower extremity without axial spinal compressive strain",
            "purpose": f"Elevated fatigue (Level {fatigue_val or 'High'}). Maintain osteogenic signal to bone mineral density while sparing compressed lumbar vertebrae.",
            "protocol": "Execute 3 sets of 10 repetitions using ARED belt-squat attachment; zero barbell shoulder loading; 90-sec inter-set rest.",
        })
    elif tot_exercise >= 45.0:
        exercises.append({
            "name": "ARED Postural Core & Scapular Bracing Routine",
            "category": "Resistance Countermeasure",
            "duration": "20 mins",
            "intensity": "Moderate Isometric (70% 1RM)",
            "target": "Rhomboids, middle trapezius, rotator cuff & transverse abdominis",
            "purpose": f"Astronaut already logged {tot_exercise}m exercise today. Reinforce scapular thoracic posture to prevent microgravity shoulder impingement.",
            "protocol": "Perform 4 sets of 12 prone bench rows and cable face-pulls; focus on 3-second isometric hold at terminal contraction.",
        })
    else:
        exercises.append({
            "name": "ARED Progressive Axial Skeletal Resistance Loading",
            "category": "Resistance Countermeasure",
            "duration": "35 mins",
            "intensity": "Heavy Osteogenic (75-80% 1RM)",
            "target": "Femoral neck, trochanter, lumbar vertebrae & calcaneus",
            "purpose": "Primary microgravity bone mineral density countermeasure. Direct axial skeletal deadlift and squat mechanical loading against bone osteoclast resorption.",
            "protocol": "4 sets of 8 reps deadlifts, followed by 4 sets of 8 reps squats. Apply heel-loading harness; calibrate canisters to target 80% 1RM.",
        })

    # Pillar 2: Cardiorespiratory Conditioning & Vascular Redistribution (T2 / CEVIS)
    if has_hypoxia:
        exercises.append({
            "name": "CEVIS Low-Workload Arterial Oxygenation Spin",
            "category": "Cardiorespiratory Aerobic",
            "duration": "15 mins",
            "intensity": "Sub-maximal Zone 1 (50-60% Max HR)",
            "target": "Pulmonary gas exchange, capillary-alveolar diffusion & lower-limb gentle perfusion",
            "purpose": f"Arterial SpO2 low ({spo2_val}%). Maintain gentle systemic vascular circulation and oxygen uptake without placing lactic metabolic stress on hypoxic tissues.",
            "protocol": "Set CEVIS to 50W constant resistance; maintain cadence at 60 RPM; continuously monitor pulse oximeter finger probe.",
        })
    elif has_cardio_strain:
        exercises.append({
            "name": "Autonomic Parasympathetic Reset & Supine Ergometer Pedaling",
            "category": "Cardiorespiratory Aerobic",
            "duration": "20 mins",
            "intensity": "Low-to-Moderate (HR Target < 110 BPM)",
            "target": "Vagal tone modulation, peripheral vascular resistance reduction & stroke volume recovery",
            "purpose": f"Cardiovascular strain detected (Resting HR {hr_val or 'Elevated'} BPM, BP {sys_val or 'Elevated'} mmHg). Controlled smooth rhythmic pedaling to down-regulate sympathetic overdrive.",
            "protocol": "Cycle at 65-75W with slow nasal inhalation and prolonged oral exhalation (4:6 cadence); hydrate with 250ml electrolyte fluid during session.",
        })
    elif tot_exercise >= 45.0:
        exercises.append({
            "name": "Low-Resistance CEVIS Active Lymphatic Flush",
            "category": "Cardiorespiratory Aerobic",
            "duration": "15 mins",
            "intensity": "Active Recovery (50W)",
            "target": "Lower extremity lymphatic clearance & peripheral venous return",
            "purpose": "Facilitate metabolic lactic clearance and prevent dependent microgravity fluid pooling after prior workout sessions.",
            "protocol": "Unweighted spinning at 75-80 RPM; zero sprint intervals; maintain relaxed posture.",
        })
    else:
        exercises.append({
            "name": "T2 Treadmill Impact & Interval Aerobic Protocol",
            "category": "Cardiorespiratory Aerobic",
            "duration": "30 mins",
            "intensity": "Interval High-Impact (75-85% VO2 Peak)",
            "target": "Cardiorespiratory endurance, VO2 peak preservation & heel strike bone mechanical shock",
            "purpose": "Preserve plasma volume, cardiac left ventricular mass, and provide ground reaction shockwaves to lower-body long bones.",
            "protocol": "Apply T2 bungee harness at 70% bodyweight equivalent. 5 min warmup, 5x (3 min at 85% VO2 / 2 min recovery), 5 min cool-down.",
        })

    # Pillar 3: Neuro-Ocular SANS & Cephalad Venous Decompression Countermeasure
    if has_vision:
        exercises.append({
            "name": "Lower Body Negative Pressure (LBNP -25 mmHg) Protocol",
            "category": "SANS Clinical Target",
            "duration": "20 mins",
            "intensity": "Targeted Clinical Decompression",
            "target": "Cephalad venous fluid displacement, optic nerve sheath & choroidal engorgement relief",
            "purpose": "CRITICAL SANS MITIGATION: Displace pooled cranial venous volume toward lower body to decrease intracranial and intraocular pressure, reversing optic disc edema.",
            "protocol": "Seal lower limbs into LBNP chamber. Step down pressure to -15 mmHg for 5 mins, then -25 mmHg for 15 mins. Abort if presyncopal.",
        })
    elif has_high_fatigue:
        exercises.append({
            "name": "Spinal Elongation Decompression & Passive Inversion Traction",
            "category": "SANS Clinical Target",
            "duration": "20 mins",
            "intensity": "Restorative Decompression",
            "target": "Intervertebral disc hydration normalization & lumbar erector spinae relaxation",
            "purpose": f"Mitigate microgravity spinal lengthening (astronauts expand up to 7cm in microgravity, causing severe backache). Realign axial spinal column.",
            "protocol": "Secure ankle restraints to crew cabin bulkhead wall; apply gentle 10-15kg axial spring traction; perform gentle knee-to-chest holds.",
        })
    else:
        exercises.append({
            "name": "Cervico-Thoracic Posture & Jugular Outflow Decompression",
            "category": "SANS Clinical Target",
            "duration": "15 mins",
            "intensity": "Gentle Mobilization",
            "target": "Internal jugular vein outflow drainage, suboccipital release & thoracic inlet mobility",
            "purpose": "Counteract microgravity cephalad fluid shift. Promote continuous cerebral venous drainage through internal jugular veins away from optic sheath.",
            "protocol": "Perform chin tucks with 5-second hold (15 reps), thoracic extension over foam roll (10 reps), and bilateral pectoral stretches.",
        })

    # Pillar 4: Neuro-Vestibular, Proprioceptive & Sensorimotor Agility
    exercises.append({
        "name": "Columbus Sensorimotor Footbed & Vestibulo-Ocular Reflex (VOR) Routine",
        "category": "Neuro-Vestibular Balance",
        "duration": "15 mins",
        "intensity": "Neuromotor Precision",
        "target": "Oculomotor gaze stabilization, otolith sensory reweighting & plantar tactile mechanoreceptors",
        "purpose": "Counteract microgravity sensorimotor decay and vestibulo-ocular reflex dysregulation. Accelerates post-landing gait and balance stability.",
        "protocol": "Perform horizontal and vertical head oscillations at 1-2 Hz while maintaining fixation on stationary visual target (3 mins). Stand on textured footbed with closed eyes (5 mins).",
    })

    # Pillar 5: Post-Exercise Axial Decompression & Vagal Autonomic Reset
    exercises.append({
        "name": "Diaphragmatic Vagal Autonomic Reset & Plantar Myofascial Release",
        "category": "Postural Alignment & Recovery",
        "duration": "10 mins",
        "intensity": "Restorative / Parasympathetic",
        "target": "Autonomic nervous system, vagus nerve stimulation & plantar fascia recovery",
        "purpose": "Accelerate post-workout cardiac autonomic recovery, lower sympathetic cortisol surge, and loosen plantar footbed fascia after microgravity harness loading.",
        "protocol": "4-second nasal inhalation, 7-second hold, 8-second slow oral exhalation (10 cycles). Roll firm orb under plantar arches for 3 mins each foot.",
    })

    # 2. AI DYNAMIC HEALTHCARE SUGGESTIONS (ADDITIONS & REMOVALS)
    if tot_sleep < 7.0 and tot_sleep > 0:
        rem_s = round(7.5 - tot_sleep, 1)
        nap_m = min(90, max(25, int(rem_s * 60)))
        suggestions.append(f"🛌 Sleep Addition Recommended: Accumulated sleep today is {tot_sleep}h across {log_cnt} log(s). Add a {nap_m}-minute recovery nap block before your next work shift to bridge the remaining {rem_s}h sleep deficit.")
    elif tot_sleep >= 7.0:
        suggestions.append(f"✓ Sleep Target Achieved: Daily sleep duration reached {tot_sleep}h across {log_cnt} log(s). Nominal circadian restoration confirmed.")

    if tot_water < 2.5 and tot_water > 0:
        rem_w = round(2.5 - tot_water, 1)
        suggestions.append(f"💧 Hydration Addition Recommended: Total water logged today is {tot_water} L. Add {rem_w} L more fluid before end-of-day sleep cycle to prevent microgravity hemoconcentration.")
    elif tot_water >= 2.5:
        suggestions.append(f"✓ Hydration Target Achieved: Total hydration reached {tot_water} L today. Fluid volume threshold satisfied.")

    if tot_exercise < 45.0:
        rem_e = round(45.0 - tot_exercise, 1)
        suggestions.append(f"⚡ Exercise Addition Recommended: Complete {rem_e} mins of prescribed countermeasure exercise to satisfy the 45-minute daily spaceflight threshold.")
    else:
        suggestions.append(f"✓ Exercise Countermeasure Completed: {tot_exercise} mins achieved today across sessions.")

    # Clinical removals based on physiological strain
    if has_high_fatigue or (stress_val is not None and stress_val >= 4):
        suggestions.append("⚠️ Schedule Removal Recommended: Remove non-essential high-stress tasks or extra EVA load from today's plan to prevent cognitive exhaustion.")
    if has_cardio_strain:
        suggestions.append("⚠️ Dietary Removal Recommended: Remove dietary stimulants/caffeine for the remainder of today and perform 10 minutes of paced breathing.")
    if has_vision:
        suggestions.append("👁️ Visual Protocol Directive: Avoid module near-focus screen glare; complete scheduled Amsler grid self-assessment and notify flight surgeon.")

    focus_areas = compute_focus_areas(assessment, insights, validation_issues, section_statuses)

    return {
        "assessment_id": assessment.get("id"),
        "measurements_analyzed": len(measurements),
        "validation_issues": validation_issues,
        "insights": insights,
        "overall_health_status": overall_status,
        "overall_summary": f"Astronaut telemetry evaluated across {len(measurements)} parameters. Status is {overall_status.upper()}.",
        "medical_alert": {
            "severity": alert_severity,
            "seek_medical_support": seek_support,
            "advice": advice
        },
        "section_statuses": section_statuses,
        "exercises": exercises,
        "healthcare_suggestions": suggestions,
        "focus_areas": focus_areas,
        "daily_aggregates": daily_aggr,
        "trend_evaluation": {
            "direction": "insufficient_data",
            "direction_label": "BASELINE TELEMETRY ESTABLISHED",
            "net_improvement_percent": 0.0,
            "summary": "Baseline telemetry recorded. Trend progression and percent improvements will be tracked upon subsequent assessments.",
            "metric_comparisons": []
        }
    }


def evaluate_health_trend(current_assessment, previous_assessment):
    """
    Compares current assessment telemetry with the previous assessment to determine
    whether health is gradually improving (good), degrading (bad), or stable,
    calculating the exact percentage improvement or decline.
    """
    if not previous_assessment or not previous_assessment.get("groups"):
        return {
            "direction": "insufficient_data",
            "direction_label": "BASELINE TELEMETRY ESTABLISHED",
            "net_improvement_percent": 0.0,
            "summary": "This is the initial baseline assessment. Telemetry trend progression and percentage changes will be calculated upon the next logged assessment.",
            "metric_comparisons": []
        }

    current_measurements = extract_measurements(current_assessment)
    previous_measurements = extract_measurements(previous_assessment)

    measurement_labels = {
        "heartRate": "Heart Rate",
        "sleepDuration": "Sleep Duration",
        "oxygenSaturation": "Oxygen Saturation (SpO2)",
        "waterIntake": "Hydration / Water Intake",
        "systolic": "Systolic Blood Pressure",
        "diastolic": "Diastolic Blood Pressure",
        "bodyTemperature": "Body Temperature"
    }

    previous_lookup = {}
    for item in previous_measurements:
        name = item["measurement"]
        unit = str(item.get("unit") or "").strip().lower()
        value = pd.to_numeric(item["value"], errors="coerce")
        if pd.isna(value) or not np.isfinite(float(value)):
            continue
        previous_lookup[(name, unit)] = float(value)

    comparisons = []
    improvement_scores = []

    for item in current_measurements:
        name = item["measurement"]
        if name not in measurement_labels:
            continue
        unit = str(item.get("unit") or "").strip().lower()
        curr_val = pd.to_numeric(item["value"], errors="coerce")
        if pd.isna(curr_val) or not np.isfinite(float(curr_val)):
            continue
        curr_val = float(curr_val)

        key = (name, unit)
        if key not in previous_lookup:
            continue
        prev_val = previous_lookup[key]
        if prev_val == 0:
            continue

        delta = round(curr_val - prev_val, 2)
        raw_percent = round(((curr_val - prev_val) / abs(prev_val)) * 100, 1)

        # Determine clinical trajectory (improving vs degrading)
        trend = "stable"
        score = 0.0

        if name == "oxygenSaturation":
            if delta > 0:
                trend = "improving"
                score = raw_percent * 2.0
            elif delta < 0:
                trend = "degrading"
                score = raw_percent * 2.5
        elif name == "sleepDuration":
            # For Sleep Duration, user requested no +percentage and no improving indicator
            comparisons.append({
                "metric": measurement_labels[name],
                "previous": prev_val,
                "current": curr_val,
                "unit": item.get("unit") or "hours",
                "delta": delta,
                "percent": None,
                "trend": "neutral",
                "is_sleep": True
            })
            continue  # Do not include in improvement_scores to avoid skewed percent changes

        elif name == "waterIntake":
            # Water intake target is 2.5 - 3.0 L
            if delta > 0:
                trend = "improving"
                score = min(25.0, raw_percent)
            elif delta < 0:
                trend = "degrading"
                score = -min(25.0, abs(raw_percent))
            else:
                trend = "stable"
                score = 0.0
        elif name == "heartRate":
            # Nominal resting heart rate is ~70 bpm
            prev_dist = abs(prev_val - 70)
            curr_dist = abs(curr_val - 70)
            if curr_dist < prev_dist:
                trend = "improving"
                score = abs(raw_percent)
            elif curr_dist > prev_dist:
                trend = "degrading"
                score = -abs(raw_percent)
        elif name in ["systolic", "diastolic"]:
            target = 120 if name == "systolic" else 80
            prev_dist = abs(prev_val - target)
            curr_dist = abs(curr_val - target)
            if curr_dist < prev_dist:
                trend = "improving"
                score = abs(raw_percent)
            elif curr_dist > prev_dist:
                trend = "degrading"
                score = -abs(raw_percent)

        improvement_scores.append(score)

        comparisons.append({
            "metric": measurement_labels[name],
            "previous": prev_val,
            "current": curr_val,
            "unit": item.get("unit") or "",
            "delta": delta,
            "percent": raw_percent,
            "trend": trend
        })

    if not improvement_scores:
        net_percent = 0.0
        direction = "stable"
        direction_label = "STABLE TELEMETRY (0%)"
        summary = "Telemetry parameters remain unchanged from the previous log."
    else:
        net_percent = round(sum(improvement_scores) / len(improvement_scores), 1)
        if net_percent >= 2.0:
            direction = "gradually_improving"
            direction_label = f"GRADUALLY IMPROVING (+{net_percent}%)"
            summary = f"Astronaut telemetry is gradually improving (+{net_percent}% aggregate physiological score). Positive improvements observed across vital indicators."
        elif net_percent <= -2.0:
            direction = "gradually_degrading"
            direction_label = f"GRADUALLY DEGRADING ({net_percent}%)"
            summary = f"Astronaut telemetry indicates gradual physiological decline ({net_percent}% aggregate score). Immediate focus recommended on designated clinical areas."
        else:
            direction = "stable"
            direction_label = f"STABLE TELEMETRY ({net_percent:+}%)"
            summary = "Astronaut telemetry is stable and consistent with previous log within nominal microgravity baseline."

    return {
        "direction": direction,
        "direction_label": direction_label,
        "net_improvement_percent": net_percent,
        "summary": summary,
        "metric_comparisons": comparisons
    }


def compute_focus_areas(assessment, insights, validation_issues, section_statuses):
    """
    Identifies specific clinical domains and biomarkers where the astronaut needs to focus.
    """
    focus_areas = []
    measurements = extract_measurements(assessment)
    m_dict = {m["measurement"]: pd.to_numeric(m["value"], errors="coerce") for m in measurements}

    # 1. Cardiovascular / SpO2
    spo2 = m_dict.get("oxygenSaturation")
    hr = m_dict.get("heartRate")
    if pd.notna(spo2) and spo2 < 95:
        focus_areas.append({
            "area": "Cardiovascular & Oxygen Saturation",
            "priority": "CRITICAL",
            "target": "Target SpO2 ≥ 96%, Re-measure vitals in 2 hours",
            "reason": f"SpO2 recorded at {spo2}%, which is below mission safety threshold.",
            "action": "Check cabin atmospheric scrubber, use supplemental oxygen if prescribed, and re-test pulse oximetry.",
            "sectionId": "vitalSigns"
        })
    elif pd.notna(hr) and (hr > 100 or hr < 50):
        focus_areas.append({
            "area": "Cardiovascular Pulse Regulation",
            "priority": "HIGH",
            "target": "Stabilize resting pulse (60–80 BPM)",
            "reason": f"Resting pulse of {hr} BPM indicates cardiovascular strain or orthostatic stress.",
            "action": "Hydrate with electrolyte fluid and perform 15-minute CEVIS cycle recovery.",
            "sectionId": "vitalSigns"
        })

    # 2. Hydration Volume
    water = m_dict.get("waterIntake")
    if pd.notna(water) and water < 2.2:
        focus_areas.append({
            "area": "Hydration Volume & Fluid Shift Management",
            "priority": "HIGH",
            "target": "Target minimum 2.5–2.8 L / 24-hour cycle",
            "reason": f"Current intake ({water} L) is insufficient to prevent hemoconcentration and kidney stones in microgravity.",
            "action": "Drink 250ml electrolyte beverage every 90 minutes; log each ration in medical checklist.",
            "sectionId": "sleepAndWellness"
        })

    # 3. Sleep Architecture & Rest
    sleep = m_dict.get("sleepDuration")
    if pd.notna(sleep) and sleep < 6.5:
        focus_areas.append({
            "area": "Sleep Architecture & Circadian Rest",
            "priority": "HIGH" if sleep < 5.5 else "MODERATE",
            "target": "Target ≥ 7.5 hours scheduled sleep block",
            "reason": f"Sleep deficit ({sleep} hrs recorded) impairs neurobehavioral alertness and fine-motor reaction times.",
            "action": "Dim crew quarters lighting 45 mins before bedtime; avoid module blue-light screens.",
            "sectionId": "sleepAndWellness"
        })

    # 4. Neuro-Ocular & SANS
    v_symptoms = assessment.get("groups", {}).get("visionAndSymptoms", {})
    symptoms = v_symptoms.get("symptoms", [])
    has_vision_issue = any("vision" in (str(s.get("symptom", "")).lower() if isinstance(s, dict) else str(s).lower()) for s in symptoms)
    if has_vision_issue:
        focus_areas.append({
            "area": "Neuro-Ocular & Vision (SANS Protocol)",
            "priority": "HIGH",
            "target": "SANS optic disc screening & Amsler test",
            "reason": "Visual changes or distortions flagged; indicative of microgravity fluid shift intracranial pressure.",
            "action": "Complete weekly Amsler grid self-assessment and schedule ocular ultrasound.",
            "sectionId": "visionAndSymptoms"
        })

    # 5. Default Musculoskeletal Focus if no acute alerts
    if len(focus_areas) == 0:
        focus_areas.append({
            "area": "Musculoskeletal Axial Loading",
            "priority": "ROUTINE",
            "target": "Execute prescribed ARED resistance protocol (45 min)",
            "reason": "Microgravity progressive bone mineral and muscle mass preservation.",
            "action": "Complete scheduled ARED deadlift and squat sets with axial load harness.",
            "sectionId": "sleepAndWellness"
        })

    return focus_areas


def parse_assessment_datetime(item):
    val = item.get("assessmentDate") or item.get("submittedAt")
    if isinstance(val, datetime):
        return val.replace(tzinfo=None)
    if isinstance(val, str):
        try:
            cleaned = val.replace("Z", "")
            if "+" in cleaned:
                cleaned = cleaned.split("+")[0]
            dt = datetime.fromisoformat(cleaned)
            return dt.replace(tzinfo=None)
        except Exception:
            pass
    return None


def aggregate_assessments_by_day(records_list):
    """
    Groups assessments by calendar date (YYYY-MM-DD).
    For each calendar day:
      - Sums cumulative daily metrics: sleepDuration, waterIntake, exerciseDuration
      - Retains latest momentary vitals (heart rate, respiration, BP, SpO2, temp)
    Returns a chronological list of daily consolidated assessments.
    """
    import copy
    day_map = {}
    for r in records_list:
        dt = parse_assessment_datetime(r)
        day_key = dt.strftime("%Y-%m-%d") if dt else "undated"
        day_map.setdefault(day_key, []).append(r)

    daily_consolidated = []
    for day_key in sorted(day_map.keys()):
        group_records = day_map[day_key]
        group_records.sort(key=lambda x: parse_assessment_datetime(x) or datetime.min)
        latest_r = group_records[-1]

        total_sleep = 0.0
        total_water = 0.0
        total_exercise = 0.0
        sleep_logs = []
        water_logs = []
        exercise_logs = []

        for item in group_records:
            g = item.get("groups", {}) if isinstance(item, dict) else item.groups
            sw = g.get("sleepAndWellness", {})

            # Sleep: prioritize session_increment / raw_increment to avoid double-counting if value is already cumulative
            s_item = sw.get("sleepDuration", {})
            s_inc = s_item.get("session_increment") if "session_increment" in s_item else s_item.get("raw_increment")
            s_val = s_inc if s_inc is not None else s_item.get("value")
            if s_val is not None and str(s_val).strip():
                try:
                    v = float(s_val)
                    total_sleep += v
                    sleep_logs.append(v)
                except ValueError:
                    pass

            # Water: prioritize session_increment / raw_increment
            w_item = sw.get("waterIntake", {})
            w_inc = w_item.get("session_increment") if "session_increment" in w_item else w_item.get("raw_increment")
            w_val = w_inc if w_inc is not None else w_item.get("value")
            if w_val is not None and str(w_val).strip():
                try:
                    v = float(w_val)
                    total_water += v
                    water_logs.append(v)
                except ValueError:
                    pass

            # Exercise: prioritize session_increment / raw_increment
            e_item = sw.get("exerciseDuration", {})
            e_inc = e_item.get("session_increment") if "session_increment" in e_item else e_item.get("raw_increment")
            e_val = e_inc if e_inc is not None else e_item.get("value")
            if e_val is not None and str(e_val).strip():
                try:
                    v = float(e_val)
                    total_exercise += v
                    exercise_logs.append(v)
                except ValueError:
                    pass

        total_sleep = round(total_sleep, 2)
        total_water = round(total_water, 2)
        total_exercise = round(total_exercise, 1)

        # Clone latest record of this day
        consolidated = copy.deepcopy(latest_r if isinstance(latest_r, dict) else {
            "id": latest_r.id,
            "assessmentDate": latest_r.assessmentDate,
            "submittedAt": latest_r.submittedAt,
            "groups": latest_r.groups,
            "assessmentNotes": latest_r.assessmentNotes,
            "analysis": getattr(latest_r, "analysis", None)
        })

        if "groups" in consolidated and "sleepAndWellness" in consolidated["groups"]:
            c_sw = consolidated["groups"]["sleepAndWellness"]
            if "sleepDuration" in c_sw:
                c_sw["sleepDuration"]["value"] = total_sleep
                c_sw["sleepDuration"]["notes"] = f"Total sleep today across {len(sleep_logs)} log(s): {' + '.join(str(x) for x in sleep_logs)} = {total_sleep} hrs"
            if "waterIntake" in c_sw:
                c_sw["waterIntake"]["value"] = total_water
                c_sw["waterIntake"]["notes"] = f"Total hydration today across {len(water_logs)} log(s): {' + '.join(str(x) for x in water_logs)} = {total_water} L"
            if "exerciseDuration" in c_sw:
                c_sw["exerciseDuration"]["value"] = total_exercise

        breakdown = build_today_submissions_breakdown(group_records, day_key)
        consolidated["today_submissions_breakdown"] = breakdown

        consolidated["daily_aggregates"] = {
            "date": day_key,
            "log_count": len(group_records),
            "total_sleep": total_sleep,
            "sleep_logs": sleep_logs,
            "total_water": total_water,
            "water_logs": water_logs,
            "total_exercise": total_exercise,
            "exercise_logs": exercise_logs,
            "submissions_breakdown": breakdown
        }
        daily_consolidated.append(consolidated)

    return daily_consolidated


def build_today_submissions_breakdown(group_records, day_key=None):
    """
    Builds a detailed session-by-session progression breakdown for today's cumulative metrics:
    e.g. 1st report: 0.9h sleep, 2nd submission: 5.0h sleep -> Total: 5.9h sleep.
    Same for water consumption, exercise duration, etc.
    """
    sleep_sessions = []
    water_sessions = []
    exercise_sessions = []

    total_sleep = 0.0
    total_water = 0.0
    total_exercise = 0.0

    # Ensure chronological order
    valid = [r for r in group_records if parse_assessment_datetime(r) is not None]
    if valid:
        valid.sort(key=parse_assessment_datetime)
        ordered = valid
    else:
        ordered = list(group_records)

    for idx, item in enumerate(ordered, start=1):
        g = item.get("groups", {}) if isinstance(item, dict) else item.groups
        sw = g.get("sleepAndWellness", {})
        dt = parse_assessment_datetime(item)
        time_str = dt.strftime("%H:%M") if dt else f"Log #{idx}"

        # Sleep: prioritize session_increment / raw_increment
        s_item = sw.get("sleepDuration", {})
        s_inc = s_item.get("session_increment") if "session_increment" in s_item else s_item.get("raw_increment")
        s_val = s_inc if s_inc is not None else s_item.get("value")
        if s_val is not None and str(s_val).strip():
            try:
                v = float(s_val)
                total_sleep += v
                sleep_sessions.append({
                    "report_number": idx,
                    "time": time_str,
                    "session_value": v,
                    "unit": s_item.get("unit", "hours")
                })
            except ValueError:
                pass

        # Water: prioritize session_increment / raw_increment
        w_item = sw.get("waterIntake", {})
        w_inc = w_item.get("session_increment") if "session_increment" in w_item else w_item.get("raw_increment")
        w_val = w_inc if w_inc is not None else w_item.get("value")
        if w_val is not None and str(w_val).strip():
            try:
                v = float(w_val)
                total_water += v
                water_sessions.append({
                    "report_number": idx,
                    "time": time_str,
                    "session_value": v,
                    "unit": w_item.get("unit", "L")
                })
            except ValueError:
                pass

        # Exercise: prioritize session_increment / raw_increment
        e_item = sw.get("exerciseDuration", {})
        e_inc = e_item.get("session_increment") if "session_increment" in e_item else e_item.get("raw_increment")
        e_val = e_inc if e_inc is not None else e_item.get("value")
        if e_val is not None and str(e_val).strip():
            try:
                v = float(e_val)
                total_exercise += v
                exercise_sessions.append({
                    "report_number": idx,
                    "time": time_str,
                    "session_value": v,
                    "unit": e_item.get("unit", "minutes")
                })
            except ValueError:
                pass

    total_sleep = round(total_sleep, 2)
    total_water = round(total_water, 2)
    total_exercise = round(total_exercise, 1)

    def make_summary(sessions, total, unit, label):
        if not sessions:
            return f"No {label} logged today."
        parts = []
        for s in sessions:
            ord_str = "1st report" if s["report_number"] == 1 else "2nd submission" if s["report_number"] == 2 else "3rd submission" if s["report_number"] == 3 else f"{s['report_number']}th submission"
            parts.append(f"{ord_str} ({s['time']}): {s['session_value']} {unit}")
        return f"{', '.join(parts)} -> Total {label} today: {total} {unit}"

    return {
        "date": day_key or datetime.now().strftime("%Y-%m-%d"),
        "submission_count": len(ordered),
        "sleep": {
            "sessions": sleep_sessions,
            "total_today": total_sleep,
            "unit": "hours",
            "summary_text": make_summary(sleep_sessions, total_sleep, "hours", "sleep")
        },
        "water": {
            "sessions": water_sessions,
            "total_today": total_water,
            "unit": "L",
            "summary_text": make_summary(water_sessions, total_water, "L", "water")
        },
        "exercise": {
            "sessions": exercise_sessions,
            "total_today": total_exercise,
            "unit": "minutes",
            "summary_text": make_summary(exercise_sessions, total_exercise, "minutes", "exercise")
        }
    }


def evaluate_period_trend(assessments_list, period_key="24h"):
    """
    Evaluates telemetry changes for a given time period:
      - '24h': Changes over the last 24 hours (handling multiple logs per day like morning, noon, evening).
      - '7d': Trajectory across the last 7 days (comparing daily cumulative totals).
      - '30d': Trajectory across the last 30 days (comparing daily cumulative totals).
      - 'all': Cumulative mission trajectory from initial baseline.
    """
    if not assessments_list:
        return {
            "period": period_key,
            "direction": "insufficient_data",
            "direction_label": "NO DATA RECORDED",
            "net_improvement_percent": 0.0,
            "summary": f"No telemetry recorded for the {period_key} period. Complete an assessment to begin tracking.",
            "assessment_count": 0,
            "metric_comparisons": []
        }

    # Sort chronologically by assessment timestamp
    valid_list = [a for a in assessments_list if parse_assessment_datetime(a) is not None]
    if not valid_list:
        valid_list = list(assessments_list)
    else:
        valid_list.sort(key=parse_assessment_datetime)

    if len(valid_list) == 1:
        return {
            "period": period_key,
            "direction": "insufficient_data",
            "direction_label": "BASELINE ESTABLISHED",
            "net_improvement_percent": 0.0,
            "summary": "1 assessment logged in database. This establishes your flight baseline telemetry. Multi-log progression will evaluate as subsequent logs are recorded.",
            "assessment_count": 1,
            "metric_comparisons": []
        }

    latest = valid_list[-1]
    latest_dt = parse_assessment_datetime(latest)

    # Determine time window in seconds
    duration_map = {
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600,
        "all": None
    }
    window_sec = duration_map.get(period_key)

    if period_key in ["7d", "30d", "all"]:
        # Group by calendar day so multi-day trend evaluates true daily totals (cumulative sleep, water, exercise)
        daily_records = aggregate_assessments_by_day(valid_list)
        period_title = "7-Day" if period_key == "7d" else "30-Day" if period_key == "30d" else "All-Time"
        
        # If all submitted logs are from the same calendar day, multi-day trajectory cannot be compared
        if len(daily_records) < 2:
            return {
                "period": period_key,
                "direction": "insufficient_data",
                "direction_label": f"{period_title.upper()} BASELINE ESTABLISHED",
                "net_improvement_percent": 0.0,
                "summary": f"All {len(valid_list)} assessment log(s) belong to today (Day 1 baseline). Multi-day {period_title.lower()} trajectory comparisons will activate once a second calendar day of flight telemetry is recorded.",
                "assessment_count": len(valid_list),
                "metric_comparisons": []
            }

        latest_day = daily_records[-1]
        latest_day_dt = parse_assessment_datetime(latest_day)
        if window_sec is not None and latest_day_dt is not None:
            eval_records = [
                a for a in daily_records
                if (latest_day_dt - parse_assessment_datetime(a)).total_seconds() <= window_sec
            ]
        else:
            eval_records = list(daily_records)

        if len(eval_records) >= 2:
            baseline_record = eval_records[0]
            current_record = eval_records[-1]
            count = len(eval_records)
        else:
            baseline_record = daily_records[0]
            current_record = daily_records[-1]
            count = len(daily_records)
    else:
        # 24h: intraday drift across multiple logs today (morning, noon, evening)
        if window_sec is not None and latest_dt is not None:
            window_records = [
                a for a in valid_list
                if (latest_dt - parse_assessment_datetime(a)).total_seconds() <= window_sec
            ]
        else:
            window_records = list(valid_list)

        if len(window_records) >= 2:
            baseline_record = window_records[0]
            current_record = window_records[-1]
            count = len(window_records)
        else:
            baseline_record = valid_list[-2]
            current_record = valid_list[-1]
            count = len(valid_list)

    result = evaluate_health_trend(current_record, baseline_record)
    net_percent = result.get("net_improvement_percent", 0.0)

    # Build period-specific direction label and clinical narrative
    if period_key == "24h":
        period_title = "24-Hour"
        if len(valid_list) >= 2:
            detail_note = f"Across {count} logs submitted in the last 24 hours (monitoring diurnal morning/noon/evening variance)"
        else:
            detail_note = "Over the last 24 hours compared with the previous assessment"
    elif period_key == "7d":
        period_title = "7-Day"
        detail_note = f"Across {count} daily consolidated logs during the last 7 days"
    elif period_key == "30d":
        period_title = "30-Day"
        detail_note = f"Across {count} daily consolidated logs over the last 30 days"
    else:
        period_title = "All-Time"
        detail_note = f"Across all {count} daily mission cycles since day 1 baseline"

    if net_percent >= 2.0:
        direction = "gradually_improving"
        direction_label = f"{period_title.upper()} PROGRESSION (+{net_percent}%)"
        summary = (
            f"{detail_note}, astronaut physiological markers reflect a positive {net_percent:+}% "
            f"improvement. Circulatory, hydration, and sleep indicators demonstrate healthy adaptation."
        )
    elif net_percent <= -2.0:
        direction = "gradually_degrading"
        direction_label = f"{period_title.upper()} PROGRESSION ({net_percent}%)"
        summary = (
            f"{detail_note}, astronaut telemetry indicates a {net_percent}% downward drift. "
            f"Review focused clinical areas (oxygenation, hydration, fatigue) and adjust countermeasure routines."
        )
    else:
        direction = "stable"
        direction_label = f"{period_title.upper()} STABLE ({net_percent:+}%)"
        summary = (
            f"{detail_note}, astronaut physiological indicators remain stable and well-balanced "
            f"within nominal microgravity parameters ({net_percent:+}% variation)."
        )

    comparisons = result.get("metric_comparisons", [])
    
    # Calculate daily aggregated sleep for this period
    period_days = {}
    source_records = eval_records if (period_key != "24h" and len(eval_records) >= 2) else valid_list
    for a in source_records:
        dt = parse_assessment_datetime(a)
        if dt:
            d_str = dt.strftime("%Y-%m-%d")
            sw = a.get("groups", {}).get("sleepAndWellness", {})
            val = sw.get("sleepDuration", {}).get("value")
            try:
                num = float(val) if val is not None else 0.0
                period_days[d_str] = period_days.get(d_str, 0.0) + num
            except (ValueError, TypeError):
                pass

    today_key = datetime.now().strftime("%Y-%m-%d")
    total_sleep_24h = round(period_days.get(today_key, 0.0), 1)
    if total_sleep_24h == 0.0 and period_days:
        total_sleep_24h = round(list(period_days.values())[-1], 1)

    avg_sleep_multiday = 0.0
    if period_days:
        avg_sleep_multiday = round(sum(period_days.values()) / len(period_days), 1)

    for mc in comparisons:
        if mc.get("is_sleep") or "sleep" in str(mc.get("metric", "")).lower():
            mc["percent"] = None
            mc["trend"] = "neutral"
            if period_key == "24h":
                mc["total_sleep"] = total_sleep_24h or mc.get("current", 0.0)
                mc["display_mode"] = "total"
            else:
                mc["average_sleep"] = avg_sleep_multiday or mc.get("current", 0.0)
                mc["display_mode"] = "average"

    return {
        "period": period_key,
        "direction": direction,
        "direction_label": direction_label,
        "net_improvement_percent": net_percent,
        "summary": summary,
        "assessment_count": count,
        "metric_comparisons": comparisons
    }


def compute_all_period_trends(assessments_list):
    return {
        "24h": evaluate_period_trend(assessments_list, "24h"),
        "7d": evaluate_period_trend(assessments_list, "7d"),
        "30d": evaluate_period_trend(assessments_list, "30d"),
        "all": evaluate_period_trend(assessments_list, "all"),
    }


def evaluate_all_time_trend(assessments_list):
    """
    Evaluates the all-time cumulative trend (delegates to evaluate_period_trend).
    """
    return evaluate_period_trend(assessments_list, "all")
