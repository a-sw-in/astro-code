import os
from datetime import datetime
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Text, JSON
from sqlalchemy.orm import declarative_base, sessionmaker

# Path to the dedicated support database (separate from astro_code_blue.db)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "astro_support.db")
SUPPORT_DATABASE_URL = f"sqlite:///{DB_PATH}"

support_engine = create_engine(
    SUPPORT_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SupportSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=support_engine
)

SupportBase = declarative_base()


class SupportChatSession(SupportBase):
    __tablename__ = "support_chat_sessions"

    session_id = Column(String, primary_key=True, index=True)
    astronaut_id = Column(String, default="ACB-014", index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String, default="ACTIVE")  # ACTIVE, ENDED
    
    chief_complaint = Column(String, default="General In-Flight Consultation")
    triage_level = Column(String, default="ROUTINE")  # ROUTINE, ELEVATED, CRITICAL
    escalated = Column(Boolean, default=False)
    escalation_reason = Column(String, nullable=True)
    escalation_link = Column(String, default="https://www.google.com")
    
    summary = Column(Text, nullable=True)
    key_recommendations = Column(JSON, default=list)
    messages = Column(JSON, default=list)  # list of {id, sender, text, timestamp, isEscalation, link}


def init_support_db():
    SupportBase.metadata.create_all(bind=support_engine)


def get_support_db():
    db = SupportSessionLocal()
    try:
        yield db
    finally:
        db.close()
