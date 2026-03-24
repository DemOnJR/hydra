import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import { runCommand } from "../orchestrator/executor.js";

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return "";
  }

  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function firstExisting(root, names = []) {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function detectNodeProfile(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  let packageJson = {};
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    packageJson = {};
  }

  const lockfilePath = firstExisting(projectRoot, [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock"
  ]);
  const packageManager = lockfilePath.endsWith("pnpm-lock.yaml")
    ? "pnpm"
    : lockfilePath.endsWith("yarn.lock")
      ? "yarn"
      : "npm";

  return {
    runtimeFamily: "node",
    runtimeVersion: String(packageJson.engines?.node || process.version || ""),
    packageManager,
    lockfilePath,
    lockfileHash: hashFile(lockfilePath),
    metadata: {
      scripts: packageJson.scripts || {},
      packageName: packageJson.name || "",
      lockfilePath
    }
  };
}

function detectPythonProfile(projectRoot) {
  const requirementsPath = firstExisting(projectRoot, ["requirements.txt", "pyproject.toml", "Pipfile"]);
  if (!requirementsPath) {
    return null;
  }

  return {
    runtimeFamily: "python",
    runtimeVersion: "",
    packageManager: requirementsPath.endsWith("Pipfile") ? "pipenv" : "pip",
    lockfilePath: requirementsPath,
    lockfileHash: hashFile(requirementsPath),
    metadata: {
      dependencyFile: path.basename(requirementsPath),
      lockfilePath: requirementsPath
    }
  };
}

function detectEnvironmentProfile(projectRoot) {
  const nodeProfile = detectNodeProfile(projectRoot);
  if (nodeProfile) {
    return nodeProfile;
  }

  const pythonProfile = detectPythonProfile(projectRoot);
  if (pythonProfile) {
    return pythonProfile;
  }

  return {
    runtimeFamily: "unknown",
    runtimeVersion: "",
    packageManager: "",
    lockfilePath: "",
    lockfileHash: "",
    metadata: {
      reason: "No recognized runtime markers found."
    }
  };
}

function upsertEnvironmentProfile(projectId, profile) {
  const db = getDb();
  const existing = db
    .prepare(
      `
        SELECT *
        FROM environment_profiles
        WHERE project_id = ?
          AND runtime_family = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
    )
    .get(projectId, profile.runtimeFamily);

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        runtimeFamily: profile.runtimeFamily,
        runtimeVersion: profile.runtimeVersion,
        packageManager: profile.packageManager,
        lockfileHash: profile.lockfileHash,
        metadata: profile.metadata
      })
    )
    .digest("hex");

  if (existing) {
    db.prepare(
      `
        UPDATE environment_profiles
        SET runtime_version = ?,
            package_manager = ?,
            lockfile_hash = ?,
            environment_path = ?,
            fingerprint = ?,
            metadata_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(
      profile.runtimeVersion,
      profile.packageManager,
      profile.lockfileHash,
      profile.environmentPath || "",
      fingerprint,
      JSON.stringify(profile.metadata || {}),
      existing.id
    );

    return db.prepare("SELECT * FROM environment_profiles WHERE id = ?").get(existing.id);
  }

  const id = uuidv4();
  db.prepare(
    `
      INSERT INTO environment_profiles (
        id,
        project_id,
        runtime_family,
        runtime_version,
        package_manager,
        lockfile_hash,
        environment_path,
        fingerprint,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    projectId,
    profile.runtimeFamily,
    profile.runtimeVersion,
    profile.packageManager,
    profile.lockfileHash,
    profile.environmentPath || "",
    fingerprint,
    JSON.stringify(profile.metadata || {})
  );

  return db.prepare("SELECT * FROM environment_profiles WHERE id = ?").get(id);
}

async function detectRuntimeAvailability(runtimeFamily) {
  switch (runtimeFamily) {
    case "node": {
      const result = await runCommand("node -v", process.cwd(), { timeout: 30000 });
      return {
        available: result.success,
        output: (result.stdout || result.stderr || "").trim(),
        exitCode: result.exitCode
      };
    }

    case "python": {
      const result = await runCommand("python --version", process.cwd(), { timeout: 30000 });
      return {
        available: result.success,
        output: (result.stdout || result.stderr || "").trim(),
        exitCode: result.exitCode
      };
    }

    default:
      return {
        available: false,
        output: `Runtime family "${runtimeFamily}" is not supported yet.`,
        exitCode: 1
      };
  }
}

function getInstallCommand(profile) {
  if (profile.runtimeFamily === "node") {
    if (profile.packageManager === "pnpm") {
      return "pnpm install";
    }

    if (profile.packageManager === "yarn") {
      return "yarn install";
    }

    return profile.lockfilePath?.endsWith("package-lock.json") ? "npm ci" : "npm install";
  }

  if (profile.runtimeFamily === "python") {
    if (profile.lockfilePath?.endsWith("requirements.txt")) {
      return "python -m pip install -r requirements.txt";
    }

    if (profile.lockfilePath?.endsWith("Pipfile")) {
      return "pipenv install";
    }

    return "python -m pip install -e .";
  }

  throw new Error(`Dependency installation is not supported for runtime "${profile.runtimeFamily}".`);
}

export async function detectEnvironment({ projectId, projectRoot }) {
  const absoluteRoot = path.resolve(String(projectRoot || "").trim());
  if (!absoluteRoot || !fs.existsSync(absoluteRoot)) {
    throw new Error("projectRoot does not exist.");
  }

  const profile = detectEnvironmentProfile(absoluteRoot);
  const persisted = upsertEnvironmentProfile(projectId, {
    ...profile,
    environmentPath: ""
  });

  return {
    profileId: persisted.id,
    projectId,
    projectRoot: absoluteRoot,
    runtimeFamily: profile.runtimeFamily,
    runtimeVersion: profile.runtimeVersion,
    packageManager: profile.packageManager,
    lockfileHash: profile.lockfileHash,
    metadata: profile.metadata
  };
}

export async function ensureRuntime({ runtimeFamily, runtimeVersion = "" }) {
  const availability = await detectRuntimeAvailability(runtimeFamily);
  return {
    runtimeFamily,
    runtimeVersion,
    ...availability
  };
}

export async function createEnvironment({ profileId, projectRoot, runtimeFamily }) {
  const db = getDb();
  const profile = profileId
    ? db.prepare("SELECT * FROM environment_profiles WHERE id = ?").get(profileId)
    : null;

  const family = String(runtimeFamily || profile?.runtime_family || "").trim();
  if (!family) {
    throw new Error("runtimeFamily is required.");
  }

  let environmentPath = "";
  if (family === "python") {
    const root = path.resolve(projectRoot || ".");
    environmentPath = path.join(root, ".hydra", "venv");
    fs.mkdirSync(path.dirname(environmentPath), { recursive: true });
    const result = await runCommand(`python -m venv "${environmentPath}"`, root, {
      timeout: 180000
    });

    if (!result.success) {
      throw new Error(result.stderr || result.stdout || "Failed to create python virtual environment.");
    }
  } else if (family === "node") {
    environmentPath = path.resolve(projectRoot || ".");
  } else {
    throw new Error(`Environment creation for runtime "${family}" is not supported.`);
  }

  if (profile?.id) {
    db.prepare(
      `
        UPDATE environment_profiles
        SET environment_path = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(environmentPath, profile.id);
  }

  return {
    profileId: profile?.id || null,
    runtimeFamily: family,
    environmentPath
  };
}

export async function installDependencies({ profileId, projectRoot }) {
  const db = getDb();
  const profile = db.prepare("SELECT * FROM environment_profiles WHERE id = ?").get(profileId);
  if (!profile) {
    throw new Error("Environment profile not found.");
  }

  const parsedMetadata = profile.metadata_json ? JSON.parse(profile.metadata_json) : {};
  const command = getInstallCommand({
    runtimeFamily: profile.runtime_family,
    packageManager: profile.package_manager,
    lockfilePath: parsedMetadata.lockfilePath || ""
  });

  const result = await runCommand(command, path.resolve(projectRoot || "."), {
    timeout: 600000,
    maxBuffer: 50 * 1024 * 1024
  });

  return {
    command,
    success: result.success,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

export function activateEnvironment({ profileId }) {
  const profile = getDb().prepare("SELECT * FROM environment_profiles WHERE id = ?").get(profileId);
  if (!profile) {
    throw new Error("Environment profile not found.");
  }

  if (profile.runtime_family === "python" && profile.environment_path) {
    const scriptsDir = process.platform === "win32" ? "Scripts" : "bin";
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    return {
      profileId,
      env: {
        VIRTUAL_ENV: profile.environment_path,
        PATH: `${path.join(profile.environment_path, scriptsDir)}${pathSeparator}${process.env.PATH || ""}`
      }
    };
  }

  return {
    profileId,
    env: {}
  };
}

export function describeEnvironment({ profileId, projectId = null }) {
  const db = getDb();
  if (profileId) {
    return db.prepare("SELECT * FROM environment_profiles WHERE id = ?").get(profileId) || null;
  }

  if (projectId) {
    return db
      .prepare(
        `
          SELECT *
          FROM environment_profiles
          WHERE project_id = ?
          ORDER BY updated_at DESC
        `
      )
      .all(projectId);
  }

  return db
    .prepare(
      `
        SELECT *
        FROM environment_profiles
        ORDER BY updated_at DESC
      `
    )
    .all();
}
