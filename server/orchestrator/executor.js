import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import simpleGit from "simple-git";
import { resolveProjectPath, validateCommand } from "./safetyGuards.js";

const execAsync = promisify(exec);
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo"
]);

function formatPath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative || ".";
}

function walkDirectory(root, currentDir, depth, maxDepth, maxEntries, lines) {
  if (depth > maxDepth || lines.length >= maxEntries) {
    return;
  }

  const entries = fs
    .readdirSync(currentDir, { withFileTypes: true })
    .filter((entry) => !IGNORED_DIRS.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (lines.length >= maxEntries) {
      break;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = formatPath(root, absolutePath);
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${entry.isDirectory() ? "[D]" : "[F]"} ${relativePath}`);

    if (entry.isDirectory()) {
      walkDirectory(root, absolutePath, depth + 1, maxDepth, maxEntries, lines);
    }
  }
}

export function listFiles(projectRoot, dir = ".", options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const maxEntries = options.maxEntries ?? 120;
  const root = path.resolve(projectRoot);
  const startDir = resolveProjectPath(root, dir);

  if (!fs.existsSync(startDir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  if (!fs.statSync(startDir).isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  const lines = [];
  walkDirectory(root, startDir, 0, maxDepth, maxEntries, lines);

  if (lines.length === 0) {
    return "(no files)";
  }

  if (lines.length >= maxEntries) {
    lines.push("... truncated ...");
  }

  return lines.join("\n");
}

export function readFile(projectRoot, filePath, options = {}) {
  const maxChars = options.maxChars ?? 120000;
  const absolutePath = resolveProjectPath(projectRoot, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");

  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n... truncated ...`;
}

export async function runCommand(command, cwd, options = {}) {
  const safeCommand = validateCommand(command);

  try {
    const { stdout, stderr } = await execAsync(safeCommand, {
      cwd,
      timeout: options.timeout ?? 60000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      windowsHide: true
    });

    return {
      success: true,
      exitCode: 0,
      stdout: stdout?.trim() ?? "",
      stderr: stderr?.trim() ?? ""
    };
  } catch (error) {
    return {
      success: false,
      exitCode: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout?.trim() ?? "",
      stderr: error.stderr?.trim() ?? error.message
    };
  }
}

export async function getGitStatus(projectRoot) {
  const git = simpleGit(projectRoot);

  try {
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return {
        ok: true,
        branch: "(not a git repository)",
        recentCommits: [],
        changedFiles: []
      };
    }

    const branch = (await git.branch()).current;
    const log = await git.log({ maxCount: 10 });
    const status = await git.status();

    return {
      ok: true,
      branch,
      recentCommits: log.all.map((commit) => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message
      })),
      changedFiles: [
        ...status.created,
        ...status.modified,
        ...status.not_added,
        ...status.deleted,
        ...status.renamed.map((item) => `${item.from} -> ${item.to}`)
      ]
    };
  } catch (error) {
    return {
      ok: false,
      branch: "(git unavailable)",
      recentCommits: [],
      changedFiles: [`git error: ${error.message}`]
    };
  }
}

export async function getGitDiff(projectRoot, baseBranch = "main") {
  const git = simpleGit(projectRoot);

  try {
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return {
        ok: true,
        diff: "(not a git repository)"
      };
    }

    const diff = await git.diff([baseBranch]);
    return {
      ok: true,
      diff: diff || "(no diff)"
    };
  } catch (error) {
    return {
      ok: false,
      error: `git diff unavailable: ${error.message}`
    };
  }
}

export function writeFile(projectRoot, filePath, content) {
  const absolutePath = resolveProjectPath(projectRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  return {
    ok: true,
    filename: filePath,
    added: content.split("\n").length,
    removed: 0
  };
}

export function replaceText(projectRoot, filePath, oldString, newString) {
  const absolutePath = resolveProjectPath(projectRoot, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  if (!content.includes(oldString)) {
    throw new Error(`Old string not found in file: ${filePath}`);
  }

  const newContent = content.replace(oldString, newString);
  fs.writeFileSync(absolutePath, newContent, "utf8");

  const addedLines = newString.split("\n").length;
  const removedLines = oldString.split("\n").length;

  return {
    ok: true,
    filename: filePath,
    added: addedLines,
    removed: removedLines,
    diff: `--- ${filePath}\n+++ ${filePath}\n- ${oldString.split("\n").join("\n- ")}\n+ ${newString.split("\n").join("\n+ ")}`
  };
}
