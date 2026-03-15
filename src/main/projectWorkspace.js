import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getProjectAgentsDir, getWorktreesRoot } from "../shared/runtimePaths.js";

const execFileAsync = promisify(execFile);

function sanitizeSegment(value, fallback = "agent") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function getProjectHash(projectRoot) {
  return createHash("sha1").update(path.resolve(projectRoot)).digest("hex").slice(0, 12);
}

async function runGit(projectRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    windowsHide: true
  });

  return stdout.trim();
}

export async function detectGitRepository(projectRoot) {
  try {
    const repoRoot = await runGit(projectRoot, ["rev-parse", "--show-toplevel"]);
    return {
      isGitRepo: Boolean(repoRoot),
      repoRoot: repoRoot || ""
    };
  } catch {
    return {
      isGitRepo: false,
      repoRoot: ""
    };
  }
}

function ensureJournalDirectory(projectRoot) {
  return getProjectAgentsDir(projectRoot);
}

export function getAgentJournalPath(projectRoot, agent) {
  const journalDir = ensureJournalDirectory(projectRoot);
  const fileName = `${sanitizeSegment(agent.session_dir || agent.name || agent.id, agent.id)}.md`;
  return path.join(journalDir, fileName);
}

export function readAgentJournal(projectRoot, agent) {
  const journalPath = getAgentJournalPath(projectRoot, agent);

  if (!fs.existsSync(journalPath)) {
    return "";
  }

  return fs.readFileSync(journalPath, "utf8");
}

export function appendAgentJournal(projectRoot, agent, entry) {
  const journalPath = getAgentJournalPath(projectRoot, agent);
  const existing = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf8") : "";
  const lines = [];

  if (!existing.trim()) {
    lines.push(`# ${agent.name}`);
    lines.push("");
  }

  lines.push(`## ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- Task: ${entry.task}`);
  lines.push(`- Status: ${entry.status}`);

  if (entry.workspacePath) {
    lines.push(`- Workspace: ${entry.workspacePath}`);
  }

  if (entry.branchName) {
    lines.push(`- Branch: ${entry.branchName}`);
  }

  lines.push("");
  lines.push("### Summary");
  lines.push("");
  lines.push(entry.summary?.trim() || "(no summary)");
  lines.push("");

  if (entry.notes) {
    lines.push("### Notes");
    lines.push("");
    lines.push(entry.notes.trim());
    lines.push("");
  }

  fs.writeFileSync(journalPath, `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}${lines.join("\n")}`, "utf8");

  return journalPath;
}

async function ensureGitWorktree(projectRoot, agent) {
  const { isGitRepo, repoRoot } = await detectGitRepository(projectRoot);

  if (!isGitRepo) {
    return {
      isGitRepo: false,
      repoRoot: path.resolve(projectRoot),
      workspacePath: path.resolve(projectRoot),
      branchName: ""
    };
  }

  const projectKey = getProjectHash(repoRoot);
  const sessionKey = sanitizeSegment(agent.session_dir || agent.name || agent.id, agent.id);
  const branchName = `hydra/${sessionKey}`;
  const workspacePath = path.join(getWorktreesRoot(), projectKey, sessionKey);

  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });

  if (fs.existsSync(path.join(workspacePath, ".git"))) {
    return {
      isGitRepo: true,
      repoRoot,
      workspacePath,
      branchName
    };
  }

  let branchExists = false;

  try {
    const output = await runGit(repoRoot, ["branch", "--list", branchName]);
    branchExists = Boolean(output.trim());
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await runGit(repoRoot, ["worktree", "add", workspacePath, branchName]);
  } else {
    await runGit(repoRoot, ["worktree", "add", "-b", branchName, workspacePath]);
  }

  return {
    isGitRepo: true,
    repoRoot,
    workspacePath,
    branchName
  };
}

export async function prepareAgentWorkspace(projectRoot, agent) {
  const canonicalProjectRoot = path.resolve(projectRoot);
  const workspace = await ensureGitWorktree(canonicalProjectRoot, agent);
  const journalPath = getAgentJournalPath(canonicalProjectRoot, agent);
  const journalContent = readAgentJournal(canonicalProjectRoot, agent);

  return {
    canonicalProjectRoot,
    workspacePath: workspace.workspacePath,
    repoRoot: workspace.repoRoot,
    branchName: workspace.branchName,
    isGitRepo: workspace.isGitRepo,
    journalPath,
    journalContent
  };
}
