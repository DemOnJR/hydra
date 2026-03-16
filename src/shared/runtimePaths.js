import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_HOME = path.join(os.homedir(), ".agent-sync");
const APP_DIR_NAME = "Hydra";

function resolveOverride(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? path.resolve(normalized) : "";
}

function defaultHydraHome() {
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        APP_DIR_NAME
      );
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_DIR_NAME.toLowerCase());
  }
}

function pathExists(targetPath) {
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function removeDirectoryIfEmpty(directoryPath) {
  try {
    if (!pathExists(directoryPath)) {
      return;
    }

    if (fs.readdirSync(directoryPath).length === 0) {
      fs.rmdirSync(directoryPath);
    }
  } catch {
    // Ignore cleanup failures for optional legacy folders.
  }
}

function movePathSync(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  try {
    fs.renameSync(sourcePath, destinationPath);
    return;
  } catch {
    fs.cpSync(sourcePath, destinationPath, { force: true, recursive: true });
  }

  try {
    fs.rmSync(sourcePath, { force: true, recursive: true });
  } catch {
    // Best-effort cleanup after copy fallback.
  }
}

function migratePathGroup(mappings) {
  const [primary] = mappings;

  if (!primary || pathExists(primary.to) || !pathExists(primary.from)) {
    return;
  }

  for (const mapping of mappings) {
    if (!pathExists(mapping.from) || pathExists(mapping.to)) {
      continue;
    }

    movePathSync(mapping.from, mapping.to);
  }
}

function sanitizeSegment(value, fallback = "project") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

export function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

export function getLegacyHydraHome() {
  return LEGACY_HOME;
}

export function getHydraHome() {
  return resolveOverride(process.env.HYDRA_HOME) || defaultHydraHome();
}

export function getDatabasePath() {
  const overridePath = resolveOverride(process.env.DB_PATH);

  if (overridePath) {
    ensureDirectory(path.dirname(overridePath));
    return overridePath;
  }

  const databasePath = path.join(getHydraHome(), "data", "hydra.db");
  const legacyDatabasePath = path.join(getLegacyHydraHome(), "data.db");

  migratePathGroup([
    { from: legacyDatabasePath, to: databasePath },
    { from: `${legacyDatabasePath}-shm`, to: `${databasePath}-shm` },
    { from: `${legacyDatabasePath}-wal`, to: `${databasePath}-wal` }
  ]);

  ensureDirectory(path.dirname(databasePath));
  return databasePath;
}

export function getSessionsDir() {
  const sessionsDir = path.join(getHydraHome(), "sessions");
  migratePathGroup([{ from: path.join(getLegacyHydraHome(), "sessions"), to: sessionsDir }]);
  return ensureDirectory(sessionsDir);
}

export function getLogsDir() {
  return ensureDirectory(path.join(getHydraHome(), "logs"));
}

export function getProjectStorageKey(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const projectHash = createHash("sha1").update(resolvedProjectRoot).digest("hex").slice(0, 12);
  const projectName = sanitizeSegment(path.basename(resolvedProjectRoot), "project");

  return `${projectName}-${projectHash}`;
}

export function getProjectRuntimeDir(projectRoot) {
  return ensureDirectory(path.join(getHydraHome(), "projects", getProjectStorageKey(projectRoot)));
}

export function getProjectAgentsDir(projectRoot) {
  const legacyHydraDir = path.join(path.resolve(projectRoot), ".hydra");
  const legacyAgentsDir = path.join(legacyHydraDir, "agents");
  const agentsDir = path.join(getProjectRuntimeDir(projectRoot), "agents");

  migratePathGroup([{ from: legacyAgentsDir, to: agentsDir }]);
  removeDirectoryIfEmpty(legacyHydraDir);

  return ensureDirectory(agentsDir);
}
