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
      workflow_state TEXT DEFAULT 'todo'
        CHECK (workflow_state IN ('todo', 'in_progress', 'in_review', 'complete', 'blocked')),
      state_reason TEXT DEFAULT '',
      required_evidence INTEGER DEFAULT 1,
      required_verification INTEGER DEFAULT 0,
      verification_status TEXT DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'passed', 'failed', 'skipped')),
      task_type TEXT DEFAULT 'implementation'
        CHECK (task_type IN ('implementation', 'review', 'verification', 'genesis', 'ops')),
      priority INTEGER DEFAULT 50,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      scheduled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
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
        CHECK (approval_mode IN ('manual', 'semi-auto', 'auto')),
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

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS task_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_state TEXT,
      to_state TEXT NOT NULL,
      actor_type TEXT DEFAULT 'system',
      actor_id TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      correlation_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_assignments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      lease_id TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      heartbeat_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'released', 'expired', 'revoked')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      correlation_id TEXT DEFAULT '',
      action TEXT NOT NULL,
      args_json TEXT DEFAULT '{}',
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'executed', 'receipted', 'attached_to_task', 'failed')),
      side_effect INTEGER DEFAULT 0,
      approval_required INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 0,
      error_message TEXT DEFAULT '',
      result_json TEXT DEFAULT '',
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_receipts (
      id TEXT PRIMARY KEY,
      tool_call_id TEXT NOT NULL UNIQUE REFERENCES tool_calls(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      ok INTEGER NOT NULL,
      side_effect INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      artifacts_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      artifact_type TEXT NOT NULL,
      title TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      content_json TEXT DEFAULT '',
      receipt_id TEXT REFERENCES tool_receipts(id) ON DELETE SET NULL,
      correlation_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processes (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      owner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      pid INTEGER,
      state TEXT NOT NULL
        CHECK (state IN ('starting', 'running', 'stopped', 'failed', 'zombie')),
      auto_restart INTEGER DEFAULT 0,
      restart_count INTEGER DEFAULT 0,
      exit_code INTEGER,
      started_at TEXT,
      ended_at TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS process_output (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system')),
      chunk TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      branch_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      base_sha TEXT DEFAULT '',
      head_sha TEXT DEFAULT '',
      owning_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'ready_to_merge', 'merged', 'abandoned')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_issues (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL
        CHECK (issue_type IN ('bug', 'error', 'wrong_logic', 'optimization', 'missing_tests')),
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
      artifact_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      provider TEXT DEFAULT '',
      status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'degraded', 'disconnected', 'closed')),
      health_score REAL DEFAULT 1,
      heartbeat_at TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_registry (
      tool_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('draft', 'testing', 'pending_approval', 'active', 'deprecated', 'archived')),
      source TEXT NOT NULL
        CHECK (source IN ('core', 'genesis', 'macro')),
      schema_json TEXT DEFAULT '{}',
      safety_classification TEXT DEFAULT 'side_effect'
        CHECK (safety_classification IN ('read_only', 'side_effect', 'destructive')),
      created_by_task TEXT,
      performance_p50_ms REAL,
      failure_rate REAL DEFAULT 0,
      reliability_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, version)
    );

    CREATE TABLE IF NOT EXISTS tool_versions (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL REFERENCES tool_registry(tool_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      schema_json TEXT DEFAULT '{}',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capability_gaps (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      workaround_attempted TEXT DEFAULT '',
      proposed_tool_name TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      status TEXT DEFAULT 'open'
        CHECK (status IN ('open', 'routed', 'deferred', 'genesis_opened', 'resolved')),
      frequency INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS genesis_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      proposed_tool_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'testing', 'pending_approval', 'approved', 'rejected', 'promoted')),
      source_path TEXT DEFAULT '',
      tests_path TEXT DEFAULT '',
      test_receipt_ids TEXT DEFAULT '[]',
      promoted_tool_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS macro_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'testing', 'pending_approval', 'active', 'deprecated', 'archived')),
      steps_json TEXT NOT NULL,
      schema_json TEXT DEFAULT '{}',
      created_by_task TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, version)
    );

    CREATE TABLE IF NOT EXISTS environment_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      runtime_family TEXT NOT NULL,
      runtime_version TEXT DEFAULT '',
      package_manager TEXT DEFAULT '',
      lockfile_hash TEXT DEFAULT '',
      environment_path TEXT DEFAULT '',
      fingerprint TEXT DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS secret_refs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      backend TEXT NOT NULL
        CHECK (backend IN ('keychain', 'vault_file')),
      reference_key TEXT NOT NULL,
      scope TEXT DEFAULT 'project',
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
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

  const appSettingsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_settings'")
    .get();

  if (appSettingsSql && !appSettingsSql.sql.includes("'semi-auto'")) {
    console.info("[DB] Migrating app_settings approval modes to include semi-auto...");
    database.transaction(() => {
      database.exec(`
        CREATE TABLE app_settings_new (
          id TEXT PRIMARY KEY CHECK (id = 'default'),
          approval_mode TEXT NOT NULL DEFAULT 'manual'
            CHECK (approval_mode IN ('manual', 'semi-auto', 'auto')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      database.exec(`
        INSERT INTO app_settings_new (id, approval_mode, updated_at)
        SELECT
          id,
          CASE approval_mode
            WHEN 'auto' THEN 'auto'
            WHEN 'semi-auto' THEN 'semi-auto'
            ELSE 'manual'
          END,
          updated_at
        FROM app_settings
      `);

      database.exec("DROP TABLE app_settings");
      database.exec("ALTER TABLE app_settings_new RENAME TO app_settings");
    })();
  }

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

  if (!taskColumns.includes("workflow_state")) {
    database.exec("ALTER TABLE tasks ADD COLUMN workflow_state TEXT DEFAULT 'todo';");
  }

  if (!taskColumns.includes("state_reason")) {
    database.exec("ALTER TABLE tasks ADD COLUMN state_reason TEXT DEFAULT '';");
  }

  if (!taskColumns.includes("required_evidence")) {
    database.exec("ALTER TABLE tasks ADD COLUMN required_evidence INTEGER DEFAULT 1;");
  }

  if (!taskColumns.includes("required_verification")) {
    database.exec("ALTER TABLE tasks ADD COLUMN required_verification INTEGER DEFAULT 0;");
  }

  if (!taskColumns.includes("verification_status")) {
    database.exec("ALTER TABLE tasks ADD COLUMN verification_status TEXT DEFAULT 'pending';");
  }

  if (!taskColumns.includes("task_type")) {
    database.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'implementation';");
  }

  if (!taskColumns.includes("priority")) {
    database.exec("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 50;");
  }

  if (!taskColumns.includes("updated_at")) {
    database.exec("ALTER TABLE tasks ADD COLUMN updated_at TEXT;");
  }

  database.exec(`
    UPDATE tasks
    SET workflow_state = CASE
      WHEN status = 'complete' THEN 'complete'
      WHEN status = 'error' THEN 'blocked'
      WHEN status IN ('sent', 'working') THEN 'in_progress'
      ELSE COALESCE(NULLIF(workflow_state, ''), 'todo')
    END
    WHERE workflow_state IS NULL
       OR workflow_state = ''
       OR workflow_state NOT IN ('todo', 'in_progress', 'in_review', 'complete', 'blocked')
  `);

  database.exec(`
    UPDATE tasks
    SET verification_status = 'pending'
    WHERE verification_status IS NULL
       OR verification_status = ''
       OR verification_status NOT IN ('pending', 'passed', 'failed', 'skipped')
  `);

  database.exec(`
    UPDATE tasks
    SET task_type = 'implementation'
    WHERE task_type IS NULL OR task_type = ''
  `);

  database.exec(`
    UPDATE tasks
    SET priority = 50
    WHERE priority IS NULL
  `);

  database.exec(`
    UPDATE tasks
    SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
    WHERE updated_at IS NULL OR updated_at = ''
  `);

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
    CREATE INDEX IF NOT EXISTS idx_tasks_workflow_state_created_at
    ON tasks(workflow_state, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
    ON task_dependencies(depends_on_task_id);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_assignments_task_status_expires
    ON task_assignments(task_id, status, lease_expires_at);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_assignments_agent_status
    ON task_assignments(agent_id, status, lease_expires_at);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_transitions_task_created
    ON task_transitions(task_id, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_calls_request_id
    ON tool_calls(request_id);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_calls_task_status
    ON tool_calls(task_id, status, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_receipts_task_created
    ON tool_receipts(task_id, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_type
    ON task_artifacts(task_id, artifact_type, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_processes_project_state
    ON processes(project_id, state, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_process_output_process_created
    ON process_output(process_id, id DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_issues_task_status
    ON review_issues(task_id, status, created_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_capability_gaps_project_status
    ON capability_gaps(project_id, status, frequency DESC, updated_at DESC);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_registry_name_status
    ON tool_registry(name, status, source);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_environment_profiles_project_runtime
    ON environment_profiles(project_id, runtime_family, updated_at DESC);
  `);

  database.exec(`
    UPDATE agents
    SET status = 'idle'
    WHERE status = 'error'
  `);

  database.exec(`
    UPDATE tasks
    SET status = 'error',
        workflow_state = 'blocked',
        state_reason = 'Recovered from unfinished runtime state after restart.',
        updated_at = datetime('now')
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
