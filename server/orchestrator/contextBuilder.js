import fs from "node:fs";
import path from "node:path";
import { getPendingTodos, getProjectById, getProjectContext } from "../db/queries.js";
import { getGitStatus, listFiles } from "./executor.js";

function readPackageMetadata(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return {
      packageName: null,
      scripts: {},
      availableChecks: []
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const scripts = parsed.scripts ?? {};
    const availableChecks = ["lint", "test", "build", "typecheck"].filter(
      (name) => typeof scripts[name] === "string"
    );

    return {
      packageName: parsed.name ?? null,
      scripts,
      availableChecks
    };
  } catch (error) {
    return {
      packageName: null,
      scripts: {},
      availableChecks: [],
      error: error.message
    };
  }
}

function buildValidationSummary(packageInfo) {
  if (packageInfo.error) {
    return `package.json exists but could not be parsed: ${packageInfo.error}`;
  }

  if (packageInfo.availableChecks.length === 0) {
    return "No standard validation scripts detected in package.json.";
  }

  return `Available validation scripts: ${packageInfo.availableChecks.join(", ")}. They have not been run yet in this session.`;
}

export async function buildOrchestratorContext(projectId) {
  const project = getProjectById(projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  const rootPath = project.root_path?.trim();

  if (!rootPath) {
    throw new Error("Project root_path is required before starting the orchestrator.");
  }

  const absoluteRoot = path.resolve(rootPath);

  if (!fs.existsSync(absoluteRoot)) {
    throw new Error(`Project root_path does not exist: ${absoluteRoot}`);
  }

  if (!fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Project root_path is not a directory: ${absoluteRoot}`);
  }

  const savedContext = getProjectContext(projectId);
  const todos = getPendingTodos(projectId, 50);
  const packageInfo = readPackageMetadata(absoluteRoot);

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      architecture: savedContext.architecture || "",
      techStack: savedContext.tech_stack || "",
      conventions: savedContext.conventions || "",
      mode: project.mode || "manual",
      rootPath: absoluteRoot,
      packageName: packageInfo.packageName
    },
    gitLog: await getGitStatus(absoluteRoot),
    testResults: {
      summary: buildValidationSummary(packageInfo),
      availableChecks: packageInfo.availableChecks
    },
    todos,
    files: listFiles(absoluteRoot, ".", { maxDepth: 3, maxEntries: 120 }),
    packageInfo
  };
}
