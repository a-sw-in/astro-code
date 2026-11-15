import re
import kaggle_ai
from datetime import datetime

DUMMY_SUPPORT_LINK = "https://www.google.com"

# Keywords and conditions triggering immediate Flight Surgeon ground support escalation
CRITICAL_CONDITIONS = [
    r"\b(chest pain|heart attack|angina|cardiac arrest|palpitations|arrhythmia)\b",
    r"\b(can'?t breathe|shortness of breath|dyspnea|suffocating|choking|hypoxia|low oxygen|spo2 < 90)\b",
    r"\b(loss of vision|blindness|papilledema|blurry vision|vision sudden|optic nerve|sans)\b",
    r"\b(decompression|bends|airlock malfunction|eva emergency|suit leak)\b",
    r"\b(severe burn|fracture|broken bone|hemorrhage|bleeding heavily|head trauma|concussion)\b",
    r"\b(carbon dioxide|co2 high|hypercapnia|toxic fumes|ammonia leak)\b",
    r"\b(radiation sickness|radiation alarm|dosimeter spike)\b",
    r"\b(unconscious|fainting|seizure|convulsion)\b",
    r"\b(call doctor|flight surgeon|connect with support|human help|emergency|talk to someone|ground medical)\b"
]

ELEVATED_CONDITIONS = [
    r"\b(severe headache|migraine|vertigo|dizziness|faint)\b",
    r"\b(motion sickness|vomit|vomiting|nausea|space adaptation|sas)\b",
    r"\b(insomnia|extreme fatigue|exhaustion|cannot sleep)\b",
    r"\b(muscle tear|joint pain|back pain|ared injury)\b",
    r"\b(fever|infection|rash|swelling)\b",
    r"\b(high blood pressure|hypertension|tachycardia)\b"
]


def evaluate_medical_escalation(text: str) -> tuple[bool, str, str]:
    """
    Evaluates text for clinical escalation urgency.
    Returns: (is_escalated, triage_level, reason)
    """
    lower = text.lower()
    
    # Check critical
    for pattern in CRITICAL_CONDITIONS:
        match = re.search(pattern, lower)
        if match:
            reason = f"Acute clinical indicator detected: '{match.group(0)}'. Immediate Flight Surgeon ground intervention indicated."
            return True, "CRITICAL", reason

    # Check elevated
    for pattern in ELEVATED_CONDITIONS:
        match = re.search(pattern, lower)
        if match:
            reason = f"Elevated in-flight physiological symptom noted: '{match.group(0)}'."
            return False, "ELEVATED", reason

    return False, "ROUTINE", "Routine physiological inquiry or mission wellness discussion."


def generate_support_chat_reply(
    user_message: str,
    conversation_history: list[dict]
) -> dict:
    """
    Generates a space medicine tele-triage response, determines triage level,
    and returns escalation metadata + dummy link (www.google.com) if medical situation warrants it.
    """
    is_escalated, triage_level, reason = evaluate_medical_escalation(user_message)
    
    # Check if prior history was already escalated
    if not is_escalated:
        for prev in conversation_history:
            if prev.get("isEscalation"):
                is_escalated = True
                triage_level = max(triage_level, "ELEVATED")
                break

    reply_text = ""
    lower = user_message.lower()

    # Attempt to query Kaggle AI model first and extract response from returned JSON
    kaggle_response = kaggle_ai.chat_with_kaggle(user_message, conversation_history)
    if kaggle_response and kaggle_response.get("reply"):
        extracted_text = kaggle_response["reply"].strip()
        print(f"Using extracted Kaggle AI response ({len(extracted_text)} chars)")
        if is_escalated and triage_level == "CRITICAL":
            reply_text = (
                f"{extracted_text}\n\n"
                f"🚨 **PRIORITY FLIGHT SURGEON ALERT TRIGGERED**\n"
                f"Ground Flight Surgeon intervention indicated: **{reason}**\n\n"
                f"👉 [**CONNECT TO FLIGHT SURGEON & MEDICAL SUPPORT TEAM**]({DUMMY_SUPPORT_LINK})"
            )
        else:
            reply_text = extracted_text
    elif is_escalated and triage_level == "CRITICAL":
        reply_text = (
            f"🚨 **PRIORITY FLIGHT SURGEON ALERT TRIGGERED**\n\n"
            f"Your report indicates an acute physiological condition requiring immediate mission clinical attention: **{reason}**\n\n"
            f"**Immediate Action Protocols:**\n"
            f"1. Cease all heavy physical activity (including ARED / CEVIS countermeasure tasks).\n"
            f"2. Transition to rest position with steady microgravity tethering.\n"
            f"3. Verify environmental ppO2 and ppCO2 readings on the nearest service module panel.\n"
            f"4. Direct telemetry link established below. Click to connect directly with Ground Flight Surgeon Medical Control:\n\n"
            f"👉 [**CONNECT TO FLIGHT SURGEON & MEDICAL SUPPORT TEAM**]({DUMMY_SUPPORT_LINK})"
        )
    elif "motion sickness" in lower or "nausea" in lower or "vomit" in lower or "sas" in lower:
        reply_text = (
            f"**Space Adaptation Syndrome (SAS) Clinical Guidance:**\n\n"
            f"Sensory neuro-vestibular conflict is common during microgravity transitions. Neuro-vestibular adaptation typically resolves within 48–72 mission hours.\n\n"
            f"**Recommended In-Flight Countermeasures:**\n"
            f"- Avoid rapid head rotational movements along pitch/yaw axes.\n"
            f"- Fixate gaze on high-contrast, stationary cabin reference points.\n"
            f"- Maintain incremental electrolyte hydration (100–150 ml sips per 30 mins).\n"
            f"- If acute nausea impairs mission duties, consider consulting Flight Surgeon for oral/IM Promethazine authorization.\n\n"
            f"If symptoms escalate or fluid retention fails, connect with Ground Support: [Flight Surgeon Ground Link]({DUMMY_SUPPORT_LINK})"
        )
    elif "vision" in lower or "blur" in lower or "eye" in lower:
        reply_text = (
            f"**Spaceflight-Associated Neuro-ocular Syndrome (SANS) Protocol:**\n\n"
            f"Cephalad fluid shift in microgravity elevates intracranial pressure and can cause optic disc edema, globe flattening, and hyperopic shifts.\n\n"
            f"**Recommended Steps:**\n"
            f"- Perform Visual Acuity Card assessment and Optical Coherence Tomography (OCT) if scheduled.\n"
            f"- Avoid prolonged head-down positioning and excessive Valsalva maneuvers during exercise.\n"
            f"- Note whether bilateral or unilateral, and if accompanied by headache.\n\n"
            f"👉 If you experience sudden blurriness or scotoma, connect immediately with Ground Flight Surgeon Support: [Ground Medical Team Link]({DUMMY_SUPPORT_LINK})"
        )
    elif "sleep" in lower or "insomnia" in lower or "tired" in lower or "fatigue" in lower:
        reply_text = (
            f"**Circadian & In-Flight Sleep Architecture Guidance:**\n\n"
            f"Disrupted light cycles and microgravity arousal frequently impact slow-wave and REM sleep cycles in orbit.\n\n"
            f"**Protocol:**\n"
            f"- Ensure crew cabin lighting is dimmed to blue-depleted wavelength 90 minutes prior to sleep period.\n"
            f"- Verify crew quarters airflow (minimum 0.08 m/s) to prevent CO2 bubble accumulation around your face.\n"
            f"- Limit caffeine/stimulant intake 6 hours prior to rest period.\n"
            f"- Log cumulative sleep hours in the Health Assessment module so the AI adapts your daily countermeasure tasks."
        )
    elif "exercise" in lower or "ared" in lower or "muscle" in lower or "sore" in lower:
        reply_text = (
            f"**In-Flight Countermeasure & Musculoskeletal Guidance:**\n\n"
            f"Countermeasure exercises (ARED resistance and T2/CEVIS cardiovascular) are critical to attenuate microgravity bone density loss and postural muscle atrophy.\n\n"
            f"**Protocol:**\n"
            f"- Perform adequate 5-minute warm-up prior to high-load eccentric squats or deadlifts.\n"
            f"- Maintain harness tension on T2 treadmill to simulate 1.0G body loading without chafing.\n"
            f"- For acute muscle strains, reduce resistive load by 30% and report localized pain scores."
        )
    elif "hello" in lower or "hi" in lower or "hey" in lower:
        reply_text = (
            f"Greetings Astronaut. I am the **ASTRO CODE BLUE Clinical Support & Medical Triage Assistant**.\n\n"
            f"I continuously monitor your mission health telemetry, symptom reports, and countermeasure status. How can I assist you with your physiological status, symptoms, or mission wellness today?\n\n"
            f"*If at any time you experience an acute emergency, I will immediately establish an uplink to the Flight Surgeon Ground Team.*"
        )
    else:
        reply_text = (
            f"**Telemetry & Health Support Response:**\n\n"
            f"Thank you for reporting this to the mission health system. I have logged your inquiry into the active tele-triage channel.\n\n"
            f"Based on orbital health protocols:\n"
            f"- Continue monitoring your physiological vital signs (Heart Rate, SpO2, and Blood Pressure) via your bio-monitor.\n"
            f"- Ensure you stay on track with scheduled hydration and rest cycles.\n\n"
            f"If you feel this condition is worsening or need human medical review, you can connect directly with Ground Flight Surgeon Support here: [Flight Surgeon Ground Support Link]({DUMMY_SUPPORT_LINK})"
        )

    return {
        "reply": reply_text,
        "is_escalated": is_escalated,
        "triage_level": triage_level,
        "escalation_reason": reason if is_escalated else None,
        "escalation_link": DUMMY_SUPPORT_LINK if is_escalated or "doctor" in lower or "support" in lower else None
    }


def generate_session_summary(messages: list[dict]) -> dict:
    """
    Summarizes the entire chat conversation when the user ends the chat.
    Returns: { chief_complaint, triage_level, summary, key_recommendations, escalated, escalation_reason }
    """
    user_texts = [m.get("text", "") for m in messages if m.get("sender") == "user"]
    all_text = " ".join(user_texts)
    
    # Check if any message in the session had an escalation
    had_escalation = any(m.get("isEscalation") for m in messages)
    triage_level = "ROUTINE"
    escalation_reason = None

    for m in messages:
        if m.get("isEscalation"):
            had_escalation = True
            triage_level = "CRITICAL"
            escalation_reason = m.get("escalationReason") or "Acute condition flagged during conversation."
            break

    if not had_escalation:
        for t in user_texts:
            _, lvl, r = evaluate_medical_escalation(t)
            if lvl == "ELEVATED":
                triage_level = "ELEVATED"
                escalation_reason = r

    # Determine chief complaint from first user text or keywords
    chief_complaint = "General Astronaut Wellness Consultation"
    if user_texts:
        first = user_texts[0].strip()
        if len(first) > 60:
            chief_complaint = first[:57] + "..."
        else:
            chief_complaint = first

    recommendations = []
    if had_escalation:
        recommendations = [
            "Immediate Ground Flight Surgeon consultation requested via secure medical telemetry link (www.google.com).",
            "Halt strenuous countermeasure routines (ARED/CEVIS) until clinical clearance is obtained.",
            "Record serial vital signs every 15 minutes and log any new neurological or visual symptoms."
        ]
    elif triage_level == "ELEVATED":
        recommendations = [
            "Maintain symptom diary and monitor for symptom progression over the next 12 hours.",
            "Adjust hydration and rest schedules according to orbital flight protocols.",
            "Schedule follow-up assessment with medical telemetry officer."
        ]
    else:
        recommendations = [
            "Continue standard mission wellness, nutrition, and exercise countermeasure schedules.",
            "Log daily vitals and cumulative hydration in the Health Assessment portal."
        ]

    summary_text = (
        f"Session completed with {len(messages)} total messages. "
        f"Chief topic: '{chief_complaint}'. "
        f"Triage status assessed as {triage_level}. "
        f"{'Flight Surgeon escalation link (www.google.com) was provided to crew.' if had_escalation else 'Symptom management provided in-cabin with no acute flight surgeon escalation required.'}"
    )

    return {
        "chief_complaint": chief_complaint,
        "triage_level": triage_level,
        "escalated": had_escalation,
        "escalation_reason": escalation_reason,
        "escalation_link": DUMMY_SUPPORT_LINK if had_escalation else None,
        "summary": summary_text,
        "key_recommendations": recommendations
    }
