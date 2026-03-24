import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../orchestrator/executor.js";
import { markTaskVerification } from "./taskLifecycle.js";
import { redactProjectSecrets } from "./secretsVault.js";

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function detectProjectArchetype(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = readJsonIfExists(packageJsonPath);
  const hasIndexHtml = fs.existsSync(path.join(projectRoot, "index.html"));
  const hasPython =
    fs.existsSync(path.join(projectRoot, "requirements.txt")) ||
    fs.existsSync(path.join(projectRoot, "pyproject.toml"));

  if (packageJson && hasIndexHtml) {
    return "web_app";
  }

  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };

  if (deps.express || deps.fastify || deps.koa) {
    return "api_backend";
  }

  if (packageJson?.bin) {
    return "cli_tool";
  }

  if (hasPython) {
    return "data_ml";
  }

  return "generic";
}

function commandExists(scripts, name) {
  return scripts && typeof scripts[name] === "string";
}

export function getDefaultVerificationCommands(projectRoot, archetype = null) {
  const detected = archetype || detectProjectArchetype(projectRoot);
  const packageJson = readJsonIfExists(path.join(projectRoot, "package.json"));
  const scripts = packageJson?.scripts || {};

  switch (detected) {
    case "web_app": {
      const commands = [];
      if (commandExists(scripts, "test")) {
        commands.push("npm test -- --runInBand");
      }
      if (commandExists(scripts, "build")) {
        commands.push("npm run build");
      }
      return commands.length ? commands : ["npm run build"];
    }

    case "api_backend": {
      const commands = [];
      if (commandExists(scripts, "test")) {
        commands.push("npm test -- --runInBand");
      }
      if (commandExists(scripts, "build")) {
        commands.push("npm run build");
      }
      return commands.length ? commands : ["npm test"];
    }

    case "cli_tool": {
      const commands = [];
      if (commandExists(scripts, "test")) {
        commands.push("npm test -- --runInBand");
      }
      return commands.length ? commands : ["npm test"];
    }

    case "data_ml": {
      if (fs.existsSync(path.join(projectRoot, "requirements.txt"))) {
        return ["python -m pytest"];
      }
      return ["python -m compileall ."];
    }

    default: {
      if (commandExists(scripts, "build")) {
        return ["npm run build"];
      }
      if (commandExists(scripts, "test")) {
        return ["npm test -- --runInBand"];
      }
      return [];
    }
  }
}

export async function runVerification({
  taskId,
  projectId = null,
  projectRoot,
  commands = null,
  archetype = null,
  timeoutMs = 600000
}) {
  const root = path.resolve(String(projectRoot || "").trim());
  if (!root || !fs.existsSync(root)) {
    throw new Error("projectRoot does not exist.");
  }

  const effectiveCommands = Array.isArray(commands)
    ? commands.map((cmd) => String(cmd || "").trim()).filter(Boolean)
    : getDefaultVerificationCommands(root, archetype);

  const startedAt = new Date().toISOString();
  if (effectiveCommands.length === 0) {
    const summary = {
      ok: true,
      skipped: true,
      reason: "No default verification commands available for this project archetype.",
      commands: []
    };

    if (taskId) {
      markTaskVerification(taskId, "skipped", summary);
    }

    return {
      ...summary,
      startedAt,
      endedAt: new Date().toISOString()
    };
  }

  const results = [];
  let allPassed = true;

  for (const command of effectiveCommands) {
    const result = await runCommand(command, root, {
      timeout: timeoutMs,
      maxBuffer: 80 * 1024 * 1024
    });

    const normalized = {
      command,
      success: result.success,
      exitCode: result.exitCode,
      stdout: redactProjectSecrets(projectId, result.stdout || ""),
      stderr: redactProjectSecrets(projectId, result.stderr || "")
    };

    results.push(normalized);
    if (!normalized.success) {
      allPassed = false;
      break;
    }
  }

  const endedAt = new Date().toISOString();
  const payload = {
    ok: allPassed,
    skipped: false,
    commands: results,
    startedAt,
    endedAt
  };

  if (taskId) {
    markTaskVerification(taskId, allPassed ? "passed" : "failed", payload);
  }

  return payload;
}
