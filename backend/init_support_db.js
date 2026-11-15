const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'astro_support.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS support_chat_sessions (
    session_id TEXT PRIMARY KEY,
    astronaut_id TEXT DEFAULT 'ACB-014',
    created_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT DEFAULT 'ACTIVE',
    chief_complaint TEXT,
    triage_level TEXT DEFAULT 'ROUTINE',
    escalated INTEGER DEFAULT 0,
    escalation_reason TEXT,
    escalation_link TEXT DEFAULT 'https://www.google.com',
    summary TEXT,
    key_recommendations TEXT,
    messages TEXT
  );
`);

console.log('astro_support.db successfully initialized at:', dbPath);
