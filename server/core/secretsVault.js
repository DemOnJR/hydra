import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import { getHydraHome } from "../../src/shared/runtimePaths.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VAULT_ROOT = path.join(getHydraHome(), "secrets");

function sanitizeSegment(value, fallback = "secret") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function ensureVaultDir(projectId) {
  const directory = path.join(VAULT_ROOT, sanitizeSegment(projectId, "project"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getSecretFilePath(projectId, name) {
  return path.join(
    ensureVaultDir(projectId),
    `${sanitizeSegment(name, "secret")}.secret.json`
  );
}

function deriveEncryptionKey() {
  const base = process.env.LOCAL_SECRET?.trim() || "hydra-local-secret-vault";
  const machineContext = `${os.hostname()}:${os.userInfo().username}:${base}`;
  return createHash("sha256").update(machineContext).digest();
}

function encryptSecret(plainText) {
  const iv = randomBytes(IV_BYTES);
  const key = deriveEncryptionKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText ?? ""), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64")
  };
}

function decryptSecret(payload) {
  const key = deriveEncryptionKey();
  const iv = Buffer.from(String(payload.iv || ""), "base64");
  const tag = Buffer.from(String(payload.tag || ""), "base64");
  const value = Buffer.from(String(payload.value || ""), "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(value), decipher.final()]);
  return decrypted.toString("utf8");
}

function upsertSecretRef({ projectId, name, backend, referenceKey }) {
  const db = getDb();
  const existing = db
    .prepare(
      `
        SELECT *
        FROM secret_refs
        WHERE project_id = ?
          AND name = ?
      `
    )
    .get(projectId, name);

  if (existing) {
    db.prepare(
      `
        UPDATE secret_refs
        SET backend = ?,
            reference_key = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(backend, referenceKey, existing.id);

    return db.prepare("SELECT * FROM secret_refs WHERE id = ?").get(existing.id);
  }

  const id = uuidv4();
  db.prepare(
    `
      INSERT INTO secret_refs (
        id,
        project_id,
        name,
        backend,
        reference_key,
        scope
      )
      VALUES (?, ?, ?, ?, ?, 'project')
    `
  ).run(id, projectId, name, backend, referenceKey);

  return db.prepare("SELECT * FROM secret_refs WHERE id = ?").get(id);
}

export function setSecret({ projectId, name, value, backend = "vault_file" }) {
  if (!String(projectId || "").trim()) {
    throw new Error("projectId is required.");
  }

  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("Secret name is required.");
  }

  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error("Secret value is required.");
  }

  const filePath = getSecretFilePath(projectId, normalizedName);
  const encrypted = encryptSecret(String(value));
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...encrypted,
        updated_at: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  const ref = upsertSecretRef({
    projectId,
    name: normalizedName,
    backend,
    referenceKey: filePath
  });

  return {
    id: ref.id,
    project_id: ref.project_id,
    name: ref.name,
    backend: ref.backend,
    scope: ref.scope,
    created_at: ref.created_at,
    updated_at: ref.updated_at
  };
}

export function listSecretRefs(projectId) {
  return getDb()
    .prepare(
      `
        SELECT id, project_id, name, backend, scope, last_used_at, created_at, updated_at
        FROM secret_refs
        WHERE project_id = ?
        ORDER BY name ASC
      `
    )
    .all(projectId);
}

export function deleteSecret({ projectId, name }) {
  const db = getDb();
  const normalizedName = String(name || "").trim();
  const row = db
    .prepare(
      `
        SELECT *
        FROM secret_refs
        WHERE project_id = ?
          AND name = ?
      `
    )
    .get(projectId, normalizedName);

  if (!row) {
    return {
      deleted: false
    };
  }

  if (row.reference_key && fs.existsSync(row.reference_key)) {
    fs.rmSync(row.reference_key, { force: true });
  }

  db.prepare("DELETE FROM secret_refs WHERE id = ?").run(row.id);

  return {
    deleted: true,
    id: row.id,
    name: row.name
  };
}

export function getSecretValue(projectId, name) {
  const row = getDb()
    .prepare(
      `
        SELECT *
        FROM secret_refs
        WHERE project_id = ?
          AND name = ?
      `
    )
    .get(projectId, String(name || "").trim());

  if (!row) {
    throw new Error(`Secret ref "${name}" not found.`);
  }

  if (!row.reference_key || !fs.existsSync(row.reference_key)) {
    throw new Error(`Secret data for "${name}" is missing.`);
  }

  const payload = JSON.parse(fs.readFileSync(row.reference_key, "utf8"));
  const value = decryptSecret(payload);

  getDb()
    .prepare(
      `
        UPDATE secret_refs
        SET last_used_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `
    )
    .run(row.id);

  return {
    ref: row,
    value
  };
}

export function injectSecretRef({ projectId, name, envKey }) {
  const normalizedKey = String(envKey || "").trim() || String(name || "").trim();
  const { ref, value } = getSecretValue(projectId, name);
  return {
    refId: ref.id,
    env: {
      [normalizedKey]: value
    }
  };
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactProjectSecrets(projectId, text) {
  let output = String(text ?? "");
  if (!projectId || !output) {
    return output;
  }

  const refs = listSecretRefs(projectId);
  for (const ref of refs) {
    try {
      const { value } = getSecretValue(projectId, ref.name);
      if (!value) {
        continue;
      }

      const pattern = new RegExp(escapeRegExp(value), "g");
      output = output.replace(pattern, "[REDACTED_SECRET]");
    } catch {
      // Skip secrets that cannot be loaded.
    }
  }

  return output;
}
