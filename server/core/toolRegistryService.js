import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import { CORE_TOOL_DEFINITIONS, TOOL_SOURCE, TOOL_STATUS } from "./constants.js";

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function seedCoreToolRegistry() {
  const db = getDb();

  const insertRegistry = db.prepare(
    `
      INSERT INTO tool_registry (
        tool_id,
        name,
        version,
        status,
        source,
        schema_json,
        safety_classification,
        failure_rate,
        reliability_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(name, version) DO UPDATE SET
        status = excluded.status,
        source = excluded.source,
        schema_json = excluded.schema_json,
        safety_classification = excluded.safety_classification,
        updated_at = datetime('now')
    `
  );

  const insertVersion = db.prepare(
    `
      INSERT OR IGNORE INTO tool_versions (
        id,
        tool_id,
        name,
        version,
        status,
        schema_json,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
  );

  db.transaction(() => {
    for (const tool of CORE_TOOL_DEFINITIONS) {
      const existing = db
        .prepare(
          `
            SELECT tool_id
            FROM tool_registry
            WHERE name = ?
              AND version = ?
          `
        )
        .get(tool.name, tool.version);
      const toolId = existing?.tool_id || uuidv4();

      insertRegistry.run(
        toolId,
        tool.name,
        tool.version,
        tool.status,
        tool.source,
        toJson(tool.schema),
        tool.safety,
        0,
        toJson({
          p50_ms: tool.performance_p50_ms ?? null,
          failure_rate: tool.failure_rate ?? 0
        })
      );

      insertVersion.run(
        uuidv4(),
        toolId,
        tool.name,
        tool.version,
        tool.status,
        toJson(tool.schema),
        toJson({
          source: tool.source,
          seeded: true
        })
      );
    }
  })();
}

export function listTools(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];

  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim());
  }

  if (filters.source) {
    where.push("source = ?");
    params.push(String(filters.source).trim());
  }

  if (filters.name) {
    where.push("name = ?");
    params.push(String(filters.name).trim());
  }

  const rows = db
    .prepare(
      `
        SELECT *
        FROM tool_registry
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY name ASC, version DESC
      `
    )
    .all(...params);

  return rows.map((row) => ({
    ...row,
    schema: parseJson(row.schema_json, {}),
    reliability: parseJson(row.reliability_json, {})
  }));
}

export function describeTool(name, options = {}) {
  const db = getDb();
  const version = options.version ? String(options.version).trim() : "";
  const normalizedName = String(name || "").trim();

  const row = version
    ? db
        .prepare(
          `
            SELECT *
            FROM tool_registry
            WHERE name = ?
              AND version = ?
            LIMIT 1
          `
        )
        .get(normalizedName, version)
    : db
        .prepare(
          `
            SELECT *
            FROM tool_registry
            WHERE name = ?
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                     created_at DESC
            LIMIT 1
          `
        )
        .get(normalizedName);

  if (!row) {
    return null;
  }

  return {
    ...row,
    schema: parseJson(row.schema_json, {}),
    reliability: parseJson(row.reliability_json, {})
  };
}

export function listToolVersions(name) {
  const normalizedName = String(name || "").trim();
  const rows = getDb()
    .prepare(
      `
        SELECT *
        FROM tool_versions
        WHERE name = ?
        ORDER BY created_at DESC
      `
    )
    .all(normalizedName);

  return rows.map((row) => ({
    ...row,
    schema: parseJson(row.schema_json, {}),
    metadata: parseJson(row.metadata_json, {})
  }));
}

export function registerCapabilityGap({
  taskId = null,
  projectId = null,
  description,
  workaroundAttempted = "",
  proposedToolName = "",
  category = "general"
}) {
  const db = getDb();
  const normalizedDescription = String(description || "").trim();
  if (!normalizedDescription) {
    throw new Error("Capability gap description is required.");
  }

  const normalizedProposedTool = String(proposedToolName || "").trim();
  const existing = db
    .prepare(
      `
        SELECT *
        FROM capability_gaps
        WHERE project_id IS ?
          AND description = ?
          AND proposed_tool_name = ?
          AND status != 'resolved'
        LIMIT 1
      `
    )
    .get(projectId, normalizedDescription, normalizedProposedTool);

  if (existing) {
    db.prepare(
      `
        UPDATE capability_gaps
        SET frequency = frequency + 1,
            workaround_attempted = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(String(workaroundAttempted || ""), existing.id);

    return db.prepare("SELECT * FROM capability_gaps WHERE id = ?").get(existing.id);
  }

  const id = uuidv4();
  db.prepare(
    `
      INSERT INTO capability_gaps (
        id,
        task_id,
        project_id,
        description,
        workaround_attempted,
        proposed_tool_name,
        category,
        status,
        frequency
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1)
    `
  ).run(
    id,
    taskId,
    projectId,
    normalizedDescription,
    String(workaroundAttempted || ""),
    normalizedProposedTool,
    String(category || "general").trim() || "general"
  );

  return db.prepare("SELECT * FROM capability_gaps WHERE id = ?").get(id);
}

export function listCapabilityGaps(filters = {}) {
  const where = [];
  const params = [];

  if (filters.projectId) {
    where.push("project_id = ?");
    params.push(String(filters.projectId).trim());
  }

  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim());
  }

  if (filters.category) {
    where.push("category = ?");
    params.push(String(filters.category).trim());
  }

  return getDb()
    .prepare(
      `
        SELECT *
        FROM capability_gaps
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY frequency DESC, updated_at DESC
      `
    )
    .all(...params);
}

export function createGenesisTask({
  taskId = null,
  projectId = null,
  proposedToolName,
  description = "",
  sourcePath = ".hydra/tools",
  testsPath = ".hydra/tools/tests"
}) {
  const normalizedName = String(proposedToolName || "").trim();
  if (!normalizedName) {
    throw new Error("proposedToolName is required.");
  }

  const id = uuidv4();
  getDb()
    .prepare(
      `
        INSERT INTO genesis_tasks (
          id,
          task_id,
          project_id,
          proposed_tool_name,
          description,
          status,
          source_path,
          tests_path,
          test_receipt_ids
        )
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, '[]')
      `
    )
    .run(
      id,
      taskId,
      projectId,
      normalizedName,
      String(description || ""),
      String(sourcePath || ".hydra/tools"),
      String(testsPath || ".hydra/tools/tests")
    );

  return getDb().prepare("SELECT * FROM genesis_tasks WHERE id = ?").get(id);
}

export function updateGenesisTaskStatus(id, status, patch = {}) {
  const normalizedStatus = String(status || "").trim();
  const allowed = new Set([
    "draft",
    "testing",
    "pending_approval",
    "approved",
    "rejected",
    "promoted"
  ]);

  if (!allowed.has(normalizedStatus)) {
    throw new Error(`Invalid genesis status "${status}".`);
  }

  getDb()
    .prepare(
      `
        UPDATE genesis_tasks
        SET status = ?,
            promoted_tool_id = COALESCE(?, promoted_tool_id),
            test_receipt_ids = COALESCE(?, test_receipt_ids),
            updated_at = datetime('now')
        WHERE id = ?
      `
    )
    .run(
      normalizedStatus,
      patch.promoted_tool_id ?? null,
      patch.test_receipt_ids ? toJson(patch.test_receipt_ids) : null,
      id
    );

  return getDb().prepare("SELECT * FROM genesis_tasks WHERE id = ?").get(id);
}

export function createMacroTool({
  name,
  version = "1.0.0",
  steps,
  schema = {},
  createdByTask = null,
  status = TOOL_STATUS.PENDING_APPROVAL
}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("Macro tool name is required.");
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Macro tool requires at least one step.");
  }

  const id = uuidv4();
  getDb()
    .prepare(
      `
        INSERT INTO macro_tools (
          id,
          name,
          version,
          status,
          steps_json,
          schema_json,
          created_by_task
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      normalizedName,
      String(version || "1.0.0").trim(),
      String(status || TOOL_STATUS.PENDING_APPROVAL).trim(),
      toJson(steps),
      toJson(schema),
      createdByTask
    );

  return getDb().prepare("SELECT * FROM macro_tools WHERE id = ?").get(id);
}

export function rollbackToolVersion(name, targetVersion = null) {
  const db = getDb();
  const normalizedName = String(name || "").trim();
  const versions = listToolVersions(normalizedName);

  if (versions.length === 0) {
    throw new Error(`Tool "${normalizedName}" has no version history.`);
  }

  const current = describeTool(normalizedName);
  const target = targetVersion
    ? versions.find((version) => version.version === targetVersion)
    : versions.find(
        (version) =>
          version.status === TOOL_STATUS.ACTIVE &&
          current &&
          version.version !== current.version
      ) || versions[1] || versions[0];

  if (!target) {
    throw new Error("No rollback target is available.");
  }

  db.transaction(() => {
    db.prepare(
      `
        UPDATE tool_registry
        SET status = CASE
          WHEN version = ? THEN 'active'
          WHEN status = 'active' THEN 'deprecated'
          ELSE status
        END,
        updated_at = datetime('now')
        WHERE name = ?
      `
    ).run(target.version, normalizedName);

    db.prepare(
      `
        UPDATE tool_versions
        SET status = CASE
          WHEN version = ? THEN 'active'
          WHEN status = 'active' THEN 'deprecated'
          ELSE status
        END
        WHERE name = ?
      `
    ).run(target.version, normalizedName);
  })();

  return describeTool(normalizedName, { version: target.version });
}

export function promoteMacroToRegistry(macroId, sourceTaskId = null) {
  const db = getDb();
  const macro = db.prepare("SELECT * FROM macro_tools WHERE id = ?").get(macroId);
  if (!macro) {
    throw new Error("Macro tool not found.");
  }

  const toolId = uuidv4();
  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO tool_registry (
          tool_id,
          name,
          version,
          status,
          source,
          schema_json,
          safety_classification,
          created_by_task,
          reliability_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'active', ?, ?, 'side_effect', ?, '{}', datetime('now'), datetime('now'))
      `
    ).run(
      toolId,
      macro.name,
      macro.version,
      TOOL_SOURCE.MACRO,
      macro.schema_json,
      sourceTaskId
    );

    db.prepare(
      `
        INSERT INTO tool_versions (
          id,
          tool_id,
          name,
          version,
          status,
          schema_json,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'))
      `
    ).run(
      uuidv4(),
      toolId,
      macro.name,
      macro.version,
      macro.schema_json,
      toJson({ promoted_from_macro: macro.id })
    );

    db.prepare(
      `
        UPDATE macro_tools
        SET status = 'active',
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(macro.id);
  })();

  return describeTool(macro.name, { version: macro.version });
}

export function getRegistryMetrics() {
  const db = getDb();
  const totalTools = db.prepare("SELECT COUNT(*) AS count FROM tool_registry").get()?.count || 0;
  const activeTools = db
    .prepare("SELECT COUNT(*) AS count FROM tool_registry WHERE status = 'active'")
    .get()?.count || 0;
  const openGaps = db
    .prepare("SELECT COUNT(*) AS count FROM capability_gaps WHERE status != 'resolved'")
    .get()?.count || 0;

  const promotedGenesis = db
    .prepare("SELECT COUNT(*) AS count FROM genesis_tasks WHERE status = 'promoted'")
    .get()?.count || 0;

  return {
    totalTools: Number(totalTools),
    activeTools: Number(activeTools),
    openCapabilityGaps: Number(openGaps),
    promotedGenesisTasks: Number(promotedGenesis)
  };
}
