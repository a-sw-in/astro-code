import os
import json
import urllib.request
import urllib.error
from datetime import datetime

# Kaggle Cloudflare Tunnel URL Configuration
KAGGLE_URL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kaggle_url.txt")

def get_kaggle_url() -> str:
    if os.path.exists(KAGGLE_URL_FILE):
        try:
            with open(KAGGLE_URL_FILE, "r", encoding="utf-8") as f:
                val = f.read().strip()
                if val:
                    return val
        except Exception:
            pass
    return os.environ.get("KAGGLE_AI_URL", "https://optical-art-plot-nascar.trycloudflare.com/").strip()

def set_kaggle_url(url: str):
    global KAGGLE_AI_URL
    KAGGLE_AI_URL = url.strip()
    try:
        with open(KAGGLE_URL_FILE, "w", encoding="utf-8") as f:
            f.write(KAGGLE_AI_URL)
    except Exception as e:
        print(f"Could not persist Kaggle URL: {e}")

KAGGLE_AI_URL = get_kaggle_url()

def analyze_trends_with_kaggle(
    period_trends: dict,
    historical_list: list | None = None
) -> dict | None:
    """
    Sends computed period trend data (24h, 7d, 30d, all) to the Kaggle /analyze-trends
    endpoint. Qwen 2.5 writes clinical narrative summaries and direction_labels for each
    period. Returns a dict keyed by period (24h/7d/30d/all), each with 'summary' and
    'direction_label' overrides. Returns None if Kaggle is offline.
    """
    url = get_kaggle_url().strip().rstrip("/")
    if not url:
        return None

    endpoint = f"{url}/analyze-trends"

    # Build a compact historical summary string from the last 10 records
    hist_lines = []
    if historical_list:
        for a in historical_list[-10:]:
            dt = a.get("assessmentDate") or a.get("submittedAt", "")[:10]
            groups = a.get("groups", {})
            sw = groups.get("sleepAndWellness", {})
            vs = groups.get("vitalSigns", {}) or groups.get("cardiovascular", {})
            sleep = sw.get("sleepDuration", {}).get("value", "?")
            water = sw.get("waterIntake", {}).get("value", "?")
            hr = (
                groups.get("cardiovascular", {}).get("measurements", {}).get("heartRate", {}).get("value") or
                groups.get("vitalSigns", {}).get("measurements", {}).get("heartRate", {}).get("value") or "?"
            )
            spo2 = (
                groups.get("respiratory", {}).get("measurements", {}).get("oxygenSaturation", {}).get("value") or
                groups.get("vitalSigns", {}).get("measurements", {}).get("oxygenSaturation", {}).get("value") or "?"
            )
            hist_lines.append(f"{dt}: sleep={sleep}h, water={water}L, HR={hr}bpm, SpO2={spo2}%")

    historical_summary = "\n".join(hist_lines) if hist_lines else ""

    body_dict = {
        "period_trends": period_trends,
        "historical_summary": historical_summary,
    }

    payload = json.dumps(body_dict, default=str).encode("utf-8")

    try:
        print(f"Calling Kaggle AI trend analysis at: {endpoint}...")
        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "AstroCodeBlue/1.0"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=90) as response:
            if response.status == 200:
                body = response.read().decode("utf-8")
                result = json.loads(body)
                print("Kaggle AI trend narratives received!")
                return result
            else:
                print(f"Kaggle AI trends returned HTTP {response.status}")
                return None
    except Exception as e:
        print(f"Could not connect to Kaggle AI trends ({endpoint}): {e}")
        return None

def analyze_with_kaggle(
    assessment_data: dict,
    previous_data: dict | None = None,
    today_breakdown: dict | None = None
) -> dict | None:
    """
    Sends assessment data (and previous assessment for trend trajectory comparison,
    plus session-by-session daily breakdown) to the Qwen 2.5 model running in your Kaggle notebook.
    Uses standard library urllib so no additional pip packages are required.
    """
    url = get_kaggle_url().strip().rstrip("/")
    if not url:
        return None

    endpoint = f"{url}/analyze"
    body_dict = {"raw_assessment": assessment_data}
    if previous_data:
        body_dict["previous_assessment"] = previous_data

    # Extract cumulative totals
    sw = assessment_data.get("groups", {}).get("sleepAndWellness", {})
    sleep_val = sw.get("sleepDuration", {}).get("value")
    water_val = sw.get("waterIntake", {}).get("value")
    ex_val = sw.get("exerciseDuration", {}).get("value")

    # Build multi-submission breakdown context
    sleep_summary = today_breakdown.get("sleep", {}).get("summary_text") if today_breakdown else f"Total sleep: {sleep_val} hrs"
    water_summary = today_breakdown.get("water", {}).get("summary_text") if today_breakdown else f"Total water: {water_val} L"
    exercise_summary = today_breakdown.get("exercise", {}).get("summary_text") if today_breakdown else f"Total exercise: {ex_val} mins"

    body_dict["today_submissions_breakdown"] = today_breakdown
    body_dict["daily_cumulative_context"] = {
        "accumulated_sleep_today_hours": sleep_val,
        "accumulated_water_today_litres": water_val,
        "accumulated_exercise_today_minutes": ex_val,
        "sleep_progression_today": sleep_summary,
        "water_progression_today": water_summary,
        "exercise_progression_today": exercise_summary,
        "clinical_instruction": (
            f"IMPORTANT MULTI-LOG CLINICAL CONTEXT FOR AI EVALUATION:\n"
            f"The astronaut may submit multiple health reports throughout the day (e.g. morning, noon, evening).\n"
            f"For cumulative metrics (sleep, water consumption, exercise), here is the exact progression across submissions today:\n"
            f"- SLEEP PROGRESSION: {sleep_summary}\n"
            f"- HYDRATION PROGRESSION: {water_summary}\n"
            f"- EXERCISE PROGRESSION: {exercise_summary}\n"
            f"- CURRENT SNAPSHOT VITALS (separate latest readings): Heart Rate, Respiration, Blood Pressure, SpO2, Temperature.\n"
            f"Evaluate overall health using the FULL COMBINED cumulative totals.\n"
            f"DYNAMIC RECOMMENDATIONS REQUIRED FROM AI:\n"
            f"1. Generate exactly 5 comprehensive tailored 'exercises' covering all spaceflight countermeasure domains: (1) Axial Heavy Resistance (ARED), (2) Cardiorespiratory & Fluid Shift (T2/CEVIS), (3) SANS & Cephalad Venous Decompression (LBNP/Spinal), (4) Neuro-Vestibular Balance & Sensorimotor, and (5) Post-Exercise Regeneration & Autonomic Reset. Each exercise must be an object with 'name', 'category', 'duration', 'intensity', 'target', 'purpose', and 'protocol' specifically adapted to this astronaut's symptoms, fatigue, SpO2, and cardiac state (do NOT return generic boilerplate).\n"
            f"2. Generate dynamic 'healthcare_suggestions': specify actionable additions (remaining sleep/nap needed, remaining hydration to reach daily target) and removals (schedule stressors, non-essential EVA workload, stimulants/caffeine)."
        )
    }

    payload = json.dumps(body_dict, default=str).encode("utf-8")

    try:
        print(f"Calling Kaggle AI at: {endpoint}...")
        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "AstroCodeBlue/1.0"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status == 200:
                body = response.read().decode("utf-8")
                result = json.loads(body)
                print("Kaggle AI analysis received successfully!")
                return result
            else:
                print(f"Kaggle AI returned HTTP {response.status}")
                return None

    except Exception as e:
        print(f"Could not connect to Kaggle AI ({endpoint}): {e}")
        return None


def extract_response_from_kaggle_json(data: any) -> str:
    """
    Robustly extracts the chat response string from any JSON structure returned by Kaggle AI.
    Supports formats from custom Flask/FastAPI, Hugging Face pipelines, Ollama, vLLM, and OpenAI API clones.
    """
    if not data:
        return ""

    if isinstance(data, str):
        # Check if the string itself is a JSON document
        stripped = data.strip()
        if (stripped.startswith("{") and stripped.endswith("}")) or (stripped.startswith("[") and stripped.endswith("]")):
            try:
                parsed = json.loads(stripped)
                extracted = extract_response_from_kaggle_json(parsed)
                if extracted:
                    return extracted
            except Exception:
                pass
        return data

    if isinstance(data, list):
        if len(data) > 0:
            return extract_response_from_kaggle_json(data[0])
        return ""

    if isinstance(data, dict):
        # 1. Direct standard keys
        for key in [
            "response",
            "reply",
            "message",
            "text",
            "content",
            "output",
            "answer",
            "result",
            "clinical_response",
            "generated_text"
        ]:
            val = data.get(key)
            if val and isinstance(val, str) and len(val.strip()) > 0:
                return val.strip()
            elif val and isinstance(val, dict):
                sub = extract_response_from_kaggle_json(val)
                if sub:
                    return sub

        # 2. Extract structured analysis from Kaggle /analyze endpoint
        summary_parts = []
        if data.get("overall_summary") and isinstance(data.get("overall_summary"), str):
            summary_parts.append(data.get("overall_summary").strip())

        med_alert = data.get("medical_alert")
        if isinstance(med_alert, dict) and med_alert.get("advice"):
            advice = str(med_alert.get("advice")).strip()
            if advice and advice not in summary_parts:
                summary_parts.append(f"**Clinical Advisory:** {advice}")

        suggestions = data.get("healthcare_suggestions")
        if isinstance(suggestions, list) and len(suggestions) > 0:
            sug_items = [f"• {str(s)}" for s in suggestions if str(s).strip()]
            if sug_items:
                summary_parts.append("**Recommended Countermeasures:**\n" + "\n".join(sug_items))

        if summary_parts:
            return "\n\n".join(summary_parts)

        # 3. OpenAI / vLLM style: choices[0].message.content
        choices = data.get("choices")
        if isinstance(choices, list) and len(choices) > 0:
            choice = choices[0]
            if isinstance(choice, dict):
                msg = choice.get("message")
                if isinstance(msg, dict) and msg.get("content"):
                    return str(msg.get("content")).strip()
                if choice.get("text"):
                    return str(choice.get("text")).strip()

        # 3. If there is a nested 'data' or 'body'
        for wrapper_key in ["data", "body", "payload"]:
            if isinstance(data.get(wrapper_key), (dict, list)):
                nested = extract_response_from_kaggle_json(data.get(wrapper_key))
                if nested:
                    return nested

        # 4. Fallback: concatenate top-level string values
        string_parts = [str(v) for k, v in data.items() if isinstance(v, str) and len(str(v).strip()) > 0]
        if string_parts:
            return "\n\n".join(string_parts)

    return str(data)


def chat_with_kaggle(
    message: str,
    conversation_history: list[dict] | None = None,
    astronaut_id: str = "ACB-014"
) -> dict | None:
    """
    Sends astronaut support chat query to the Kaggle AI model.
    Tries endpoints in order (/chat, /support-chat, /generate, /analyze),
    parses the returned JSON, and extracts the response text.
    """
    url = get_kaggle_url().strip().rstrip("/")
    if not url:
        return None

    # Filter recent history for prompt context
    recent_msgs = []
    if conversation_history:
        for m in conversation_history[-6:]:
            recent_msgs.append({
                "role": "user" if m.get("sender") == "user" else "assistant",
                "content": m.get("text", "")
            })

    payload_dict = {
        "message": message,
        "prompt": message,
        "astronaut_id": astronaut_id,
        "history": recent_msgs,
        "system_instruction": (
            "You are the ASTRO CODE BLUE Clinical Support & Medical Triage Assistant aboard an active space mission. "
            "You evaluate astronaut symptoms, microgravity adaptation, and health status. "
            "If an acute medical emergency is indicated, state that ground flight surgeon escalation is warranted."
        )
    }

    payload = json.dumps(payload_dict, default=str).encode("utf-8")

    # Try common endpoint candidates
    endpoints_to_try = [
        f"{url}/chat",
        f"{url}/support-chat",
        f"{url}/generate",
        f"{url}/analyze"
    ]

    for ep in endpoints_to_try:
        try:
            print(f"Attempting Kaggle AI chat request at: {ep}...")
            
            # Format payload specifically for endpoint requirements
            if ep.endswith("/analyze"):
                now_iso = datetime.now().isoformat()
                req_payload = {
                    "raw_assessment": {
                        "id": f"chat-{int(datetime.now().timestamp())}",
                        "assessmentDate": now_iso,
                        "submittedAt": now_iso,
                        "assessmentNotes": f"ASTRONAUT TELE-TRIAGE LIVE CHAT INQUIRY: {message}",
                        "groups": {
                            "visionAndSymptoms": {
                                "measurements": {},
                                "symptoms": [
                                    {
                                        "symptom": message,
                                        "severity": "moderate",
                                        "recordedAt": now_iso,
                                        "source": "self_reported",
                                        "notes": f"Submitted via tele-triage chat (Astronaut {astronaut_id})"
                                    }
                                ]
                            },
                            "sleepAndWellness": {
                                "sleepDuration": { "value": 8.0, "unit": "hours", "recordedAt": now_iso, "source": "self_reported" },
                                "waterIntake": { "value": 2.5, "unit": "litres", "recordedAt": now_iso, "source": "self_reported" },
                                "exerciseDuration": { "value": 45, "unit": "minutes", "recordedAt": now_iso, "source": "self_reported" }
                            },
                            "cardiovascular": {
                                "measurements": {
                                    "heartRate": { "value": 72, "unit": "BPM", "recordedAt": now_iso, "source": "device" }
                                }
                            },
                            "respiratory": {
                                "measurements": {
                                    "oxygenSaturation": { "value": 98, "unit": "%", "recordedAt": now_iso, "source": "device" }
                                }
                            }
                        }
                    },
                    "message": message,
                    "prompt": message,
                    "astronaut_id": astronaut_id,
                    "daily_cumulative_context": {
                        "clinical_instruction": (
                            f"ASTRONAUT LIVE CHAT TELE-TRIAGE CONSULTATION:\n"
                            f"Astronaut {astronaut_id} is reporting: \"{message}\".\n"
                            f"Assess their symptoms and provide concise, practical clinical guidance for the crew."
                        )
                    }
                }
            else:
                req_payload = payload_dict

            payload_bytes = json.dumps(req_payload, default=str).encode("utf-8")

            req = urllib.request.Request(
                ep,
                data=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "AstroCodeBlue/1.0"
                },
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status == 200:
                    raw_body = response.read().decode("utf-8")
                    parsed_json = json.loads(raw_body)
                    extracted_reply = extract_response_from_kaggle_json(parsed_json)
                    print(f"Kaggle AI response successfully extracted from {ep}!")
                    return {
                        "reply": extracted_reply,
                        "raw_json": parsed_json,
                        "endpoint_used": ep
                    }
                else:
                    print(f"Kaggle AI endpoint {ep} returned status {response.status}")
        except urllib.error.HTTPError as he:
            print(f"Kaggle AI endpoint {ep} HTTP error: {he.code}")
            # If 404 or 405, try next endpoint candidate
            if he.code in (404, 405):
                continue
            break
        except Exception as e:
            print(f"Kaggle AI connection error for {ep}: {e}")
            break

    return None

