import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_MODELS } from "../ai/modelConfig.js";
import { getDatabasePath } from "../../src/shared/runtimePaths.js";

const resolvedDbPath = getDatabasePath();

let db;

function ensureDbDirectory() {
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
}

export function getDb() {
  if (!db) {
    ensureDbDirectory();
    db = new Database(resolvedDbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }

  return db;
}

export function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      root_path TEXT DEFAULT '',
      github_link TEXT DEFAULT '',
      mode TEXT DEFAULT 'manual'
        CHECK (mode IN ('manual', 'semi-auto', 'full-auto')),
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_context (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      architecture TEXT DEFAULT '',
      tech_stack TEXT DEFAULT '',
      conventions TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'other'
        CHECK (category IN ('architecture', 'convention', 'bug-fix', 'dependency', 'other')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL
        CHECK (platform IN ('chatgpt', 'gemini', 'claude', 'ollama', 'local', 'other')),
      role TEXT NOT NULL DEFAULT 'worker'
        CHECK (role IN ('orchestrator', 'worker')),
      specialty TEXT DEFAULT '',
      partition TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'idle'
        CHECK (status IN ('idle', 'working', 'done', 'error', 'sleeping')),
      session_dir TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      user_task TEXT NOT NULL,
      response TEXT DEFAULT '',
      status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'working', 'complete', 'error')),
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      scheduled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      prompt_template TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      orchestrator_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.orchestrator}',
      builder_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.builder}',
      reviewer_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.reviewer}',
      tester_model TEXT NOT NULL DEFAULT '${DEFAULT_MODELS.tester}',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      approval_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (approval_mode IN ('manual', 'auto')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_todos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'complete')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orchestrator_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      mode TEXT NOT NULL
        CHECK (mode IN ('manual', 'semi-auto', 'full-auto')),
      status TEXT DEFAULT 'running'
        CHECK (status IN ('running', 'waiting_approval', 'complete', 'error', 'stopped')),
      orchestrator_model TEXT NOT NULL,
      branch TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      current_cycle INTEGER DEFAULT 0,
      max_cycles INTEGER DEFAULT 8,
      decision TEXT DEFAULT 'pending'
        CHECK (decision IN ('pending', 'approved', 'rejected')),
      dry_run INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
      level TEXT DEFAULT 'info'
        CHECK (level IN ('info', 'warning', 'error')),
      message TEXT NOT NULL,
      data TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      channel TEXT NOT NULL DEFAULT 'worker'
        CHECK (channel IN ('orchestrator', 'worker', 'system')),
      speaker TEXT NOT NULL DEFAULT 'user'
        CHECK (speaker IN ('user', 'assistant', 'tool', 'system')),
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_compactions (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      orchestrator_summary TEXT DEFAULT '',
      worker_summary TEXT DEFAULT '',
      shared_summary TEXT DEFAULT '',
      recent_changes TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
      title,
      content,
      content=decisions,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
      INSERT INTO decisions_fts (rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
      INSERT INTO decisions_fts (decisions_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
      INSERT INTO decisions_fts (decisions_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
      INSERT INTO decisions_fts (rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;
  `);

  database
    .prepare("INSERT INTO ai_settings (id) VALUES ('default') ON CONFLICT(id) DO NOTHING")
    .run();

  database
    .prepare("INSERT INTO app_settings (id) VALUES ('default') ON CONFLICT(id) DO NOTHING")
    .run();

  const projectColumns = database
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((column) => column.name);

  if (!projectColumns.includes("root_path")) {
    database.exec("ALTER TABLE projects ADD COLUMN root_path TEXT DEFAULT '';");
  }

  if (!projectColumns.includes("github_link")) {
    database.exec("ALTER TABLE projects ADD COLUMN github_link TEXT DEFAULT '';");
  }

  if (!projectColumns.includes("mode")) {
    database.exec("ALTER TABLE projects ADD COLUMN mode TEXT DEFAULT 'manual';");
  }

  database
    .prepare(`
      UPDATE projects
      SET mode = 'manual'
      WHERE mode IS NULL OR mode = ''
    `)
    .run();

  const agentColumns = database
    .prepare("PRAGMA table_info(agents)")
    .all()
    .map((column) => column.name);

  if (!agentColumns.includes("role")) {
    database.exec("ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'worker';");
  }

  if (!agentColumns.includes("specialty")) {
    database.exec("ALTER TABLE agents ADD COLUMN specialty TEXT DEFAULT '';");
  }

  database
    .prepare(`
      UPDATE agents
      SET role = 'worker'
      WHERE role IS NULL OR role = ''
    `)
    .run();

  if (!agentColumns.includes("session_dir")) {
    database.exec("ALTER TABLE agents ADD COLUMN session_dir TEXT DEFAULT '';");
  }

  const taskColumns = database
    .prepare("PRAGMA table_info(tasks)")
    .all()
    .map((column) => column.name);

  if (!taskColumns.includes("model")) {
    database.exec("ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT '';");
  }

  if (!taskColumns.includes("provider")) {
    database.exec("ALTER TABLE tasks ADD COLUMN provider TEXT DEFAULT '';");
  }

  if (!taskColumns.includes("prompt_tokens")) {
    database.exec("ALTER TABLE tasks ADD COLUMN prompt_tokens INTEGER;");
  }

  if (!taskColumns.includes("completion_tokens")) {
    database.exec("ALTER TABLE tasks ADD COLUMN completion_tokens INTEGER;");
  }

  if (!taskColumns.includes("total_tokens")) {
    database.exec("ALTER TABLE tasks ADD COLUMN total_tokens INTEGER;");
  }

  if (!taskColumns.includes("cost_usd")) {
    database.exec("ALTER TABLE tasks ADD COLUMN cost_usd REAL;");
  }

  database
    .prepare(`
      UPDATE agents
      SET session_dir = 'agent-' || id
      WHERE session_dir IS NULL OR session_dir = ''
    `)
    .run();

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_session_dir
    ON agents(session_dir);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_turns_project_created_at
    ON conversation_turns(project_id, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_turns_channel_created_at
    ON conversation_turns(project_id, channel, created_at DESC);
  `);

  database.exec(`
    UPDATE agents
    SET status = 'idle'
    WHERE status = 'error'
  `);

  database.exec(`
    UPDATE tasks
    SET status = 'error'
    WHERE status IN ('pending', 'sent', 'working')
  `);

  // Migration: Update 'platform' and 'status' CHECK constraints in agents table
  const agentsSql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get();
  
  if (agentsSql && (!agentsSql.sql.includes("'local'") || !agentsSql.sql.includes("'sleeping'"))) {
    console.info("[DB] Migrating agents table to support new platforms and statuses...");
    database.transaction(() => {
      // 1. Create a temporary table with the new schema
      database.exec(`
        CREATE TABLE agents_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          platform TEXT NOT NULL
            CHECK (platform IN ('chatgpt', 'gemini', 'claude', 'ollama', 'local', 'other')),
          role TEXT NOT NULL DEFAULT 'worker'
            CHECK (role IN ('orchestrator', 'worker')),
          specialty TEXT DEFAULT '',
          partition TEXT NOT NULL UNIQUE,
          status TEXT DEFAULT 'idle'
            CHECK (status IN ('idle', 'working', 'done', 'error', 'sleeping')),
          session_dir TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // 2. Copy data from the old table
      database.exec("INSERT INTO agents_new SELECT * FROM agents");

      // 3. Drop the old table
      database.exec("DROP TABLE agents");

      // 4. Rename the new table
      database.exec("ALTER TABLE agents_new RENAME TO agents");

      // 5. Recreate indexes
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_session_dir
        ON agents(session_dir);
      `);
    })();
    console.info("[DB] Migration complete.");
  }

  return database;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function getDbPath() {
  return resolvedDbPath;
}
