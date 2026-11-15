
from sqlalchemy import Column, String, DateTime, JSON, Float, Integer
from database import Base


class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(String, primary_key=True, index=True)
    assessmentDate = Column(DateTime, nullable=False)
    submittedAt = Column(DateTime, nullable=False)
    groups = Column(JSON, nullable=False)
    assessmentNotes = Column(String, nullable=True)

    # Store automatic analysis results
    analysis = Column(JSON, nullable=True)


class DailyCumulativeHealth(Base):
    """
    Tracks accumulated daily cumulative metrics (sleep duration, water intake, exercise duration)
    across all logs submitted for each calendar date. Momentary vitals (heart rate, BP, SpO2, etc.)
    remain separate on individual assessment logs.
    """
    __tablename__ = "daily_cumulative_health"

    date = Column(String, primary_key=True, index=True)  # YYYY-MM-DD
    totalSleepDuration = Column(Float, default=0.0)       # accumulated hours today
    totalWaterIntake = Column(Float, default=0.0)         # accumulated litres today
    totalExerciseDuration = Column(Float, default=0.0)    # accumulated minutes today
    logCount = Column(Integer, default=1)                 # number of logs today
    lastUpdated = Column(DateTime, nullable=False)
    metadata_json = Column(JSON, nullable=True)           # log breakdown history
