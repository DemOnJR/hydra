import { BrowserWindow, dialog } from "electron";
import { exec, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const MAX_FILE_READ_CHARS = 120000;
const MAX_FILE_WRITE_CHARS = 500000;
const MAX_PATCH_CHARS = 400000;
const MAX_LIST_ENTRIES = 150;
const MAX_SEARCH_MATCHES = 120;
const MAX_MULTI_READ_FILES = 8;
const MAX_MULTI_READ_TOTAL_CHARS = 160000;
const MAX_BATCH_ACTIONS = 6;
const DEFAULT_READ_LINE_COUNT = 120;
const MAX_READ_LINE_COUNT = 400;
const MAX_LINE_SNIPPET_CHARS = 300;
const MAX_READ_LINE_CHARS = 2000;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo"
]);

const FORBIDDEN_COMMAND_PATTERNS = [
  "rm -rf",
  "del /f",
  "format ",
  "shutdown ",
  "restart-computer",
  "drop table",
  "truncate table",
  "git push --force",
  "git reset --hard",
  "git clean -fd",
  "Remove-Item -Recurse",
  "sudo "
];

const READ_ONLY_BATCH_ACTIONS = new Set([
  "list_files",
  "search_files",
  "read_file",
  "read_file_lines",
  "read_files"
]);

function resolveProjectPath(projectRoot, targetPath = ".") {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Path escapes project root: ${targetPath}`);
  }

  return resolvedTarget;
}

function validateCommand(command) {
  const normalized = String(command ?? "").trim();

  if (!normalized) {
    throw new Error("Command is required.");
  }

  const lower = normalized.toLowerCase();

  for (const forbidden of FORBIDDEN_COMMAND_PATTERNS) {
    if (lower.includes(forbidden.toLowerCase())) {
      throw new Error(`Forbidden command pattern detected: ${forbidden}`);
    }
  }

  return normalized;
}

function walkDirectory(root, currentDir, depth, maxDepth, lines) {
  if (depth > maxDepth || lines.length >= MAX_LIST_ENTRIES) {
    return;
  }

  const entries = fs
    .readdirSync(currentDir, { withFileTypes: true })
    .filter((entry) => !IGNORED_DIRS.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (lines.length >= MAX_LIST_ENTRIES) {
      break;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, absolutePath) || ".";
    lines.push(`${"  ".repeat(depth)}${entry.isDirectory() ? "[D]" : "[F]"} ${relativePath}`);

    if (entry.isDirectory()) {
      walkDirectory(root, absolutePath, depth + 1, maxDepth, lines);
    }
  }
}

function listFiles(projectRoot, dir = ".", maxDepth = 3) {
  const root = path.resolve(projectRoot);
  const startDir = resolveProjectPath(root, dir);

  if (!fs.existsSync(startDir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  if (!fs.statSync(startDir).isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  const lines = [];
  walkDirectory(root, startDir, 0, maxDepth, lines);

  return lines.length >= MAX_LIST_ENTRIES
    ? `${lines.join("\n")}\n... truncated ...`
    : lines.join("\n") || "(no files)";
}

function trimSnippet(value, maxChars = MAX_LINE_SNIPPET_CHARS) {
  const text = String(value ?? "").trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function normalizeSearchLine(line) {
  const text = String(line ?? "").replace(/\r$/, "");
  const first = text.indexOf(":");

  if (first < 0) {
    return trimSnippet(text);
  }

  const second = text.indexOf(":", first + 1);
  if (second < 0) {
    return trimSnippet(text);
  }

  const file = text.slice(0, first);
  const lineNo = text.slice(first + 1, second);
  const snippet = trimSnippet(text.slice(second + 1));

  return `${file}:${lineNo}: ${snippet}`;
}

function searchFilesSlow(projectRoot, pattern, dir = ".") {
  const root = path.resolve(projectRoot);
  const startDir = resolveProjectPath(root, dir);
  const needle = String(pattern ?? "").trim().toLowerCase();

  if (!needle) {
    throw new Error("Search pattern is required.");
  }

  if (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const matches = [];

  function walk(currentDir) {
    if (matches.length >= MAX_SEARCH_MATCHES) {
      return;
    }

    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .filter((entry) => !IGNORED_DIRS.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        return;
      }

      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let content = "";
      try {
        content = fs.readFileSync(absolutePath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.toLowerCase().includes(needle)) {
          matches.push(
            `${path.relative(root, absolutePath)}:${index + 1}: ${trimSnippet(line)}`
          );
        }

        if (matches.length >= MAX_SEARCH_MATCHES) {
          return;
        }
      }
    }
  }

  walk(startDir);

  return matches.length
    ? matches.join("\n")
    : "(no matches)";
}

let cachedRipgrepAvailable = null;

function isRipgrepAvailable() {
  if (cachedRipgrepAvailable != null) {
    return cachedRipgrepAvailable;
  }

  try {
    const result = spawnSync("rg", ["--version"], {
      encoding: "utf8",
      windowsHide: true
    });
    cachedRipgrepAvailable = result.status === 0;
  } catch {
    cachedRipgrepAvailable = false;
  }

  return cachedRipgrepAvailable;
}

function runLineLimitedProcess(command, args, options = {}) {
  const cwd = options.cwd;
  const maxLines = Number.isInteger(options.maxLines) ? options.maxLines : MAX_SEARCH_MATCHES;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 20000;

  return new Promise((resolve) => {
    let resolved = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const lines = [];
    let timedOut = false;
    let truncated = false;

    function finish(result) {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(result);
    }

    let child;

    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true
      });
    } catch (error) {
      finish({ ok: false, exitCode: 1, lines: [], stderr: String(error?.message ?? error), truncated: false, timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    function drainStdout() {
      while (lines.length < maxLines) {
        const idx = stdoutBuffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        lines.push(line.replace(/\r$/, ""));
        if (lines.length >= maxLines) {
          truncated = true;
          try {
            child.kill();
          } catch {
            // ignore
          }
          break;
        }
      }
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString("utf8");
        drainStdout();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString("utf8");
      });
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        exitCode: 1,
        lines,
        stderr: String(error?.message ?? error),
        truncated,
        timedOut
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      drainStdout();
      if (!truncated && stdoutBuffer.trim() && lines.length < maxLines) {
        lines.push(stdoutBuffer.replace(/\r$/, "").trimEnd());
      }

      finish({
        ok: code === 0,
        exitCode: Number.isInteger(code) ? code : 1,
        lines,
        stderr: stderrBuffer.trim(),
        truncated,
        timedOut
      });
    });
  });
}

async function searchFiles(projectRoot, pattern, dir = ".") {
  const root = path.resolve(projectRoot);
  const startDir = resolveProjectPath(root, dir);
  const needle = String(pattern ?? "").trim();

  if (!needle) {
    throw new Error("Search pattern is required.");
  }

  if (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const relDir = path.relative(root, startDir) || ".";

  if (isRipgrepAvailable()) {
    const globArgs = [];
    for (const ignored of IGNORED_DIRS) {
      globArgs.push("--glob", `!${ignored}/**`);
    }

    const rgResult = await runLineLimitedProcess(
      "rg",
      [
        "-n",
        "--no-heading",
        "--color=never",
        "--fixed-string",
        "--ignore-case",
        "--max-count",
        "3",
        ...globArgs,
        needle,
        relDir
      ],
      { cwd: root, maxLines: MAX_SEARCH_MATCHES, timeoutMs: 20000 }
    );

    if (rgResult.exitCode === 0 || rgResult.exitCode === 1 || rgResult.truncated) {
      const outputLines = rgResult.lines.map(normalizeSearchLine).filter(Boolean);
      const output = outputLines.length
        ? outputLines.join("\n")
        : "(no matches)";
      return rgResult.truncated ? `${output}\n... truncated ...` : output;
    }
  }

  const gitResult = await runLineLimitedProcess(
    "git",
    ["grep", "-n", "-I", "-F", "-i", needle, "--", relDir],
    { cwd: root, maxLines: MAX_SEARCH_MATCHES, timeoutMs: 20000 }
  );

  if (gitResult.exitCode === 0 || gitResult.exitCode === 1 || gitResult.truncated) {
    const outputLines = gitResult.lines.map(normalizeSearchLine).filter(Boolean);
    const output = outputLines.length
      ? outputLines.join("\n")
      : "(no matches)";
    return gitResult.truncated ? `${output}\n... truncated ...` : output;
  }

  return searchFilesSlow(projectRoot, pattern, dir);
}

function readFileWithLimit(projectRoot, filePath, maxChars = MAX_FILE_READ_CHARS) {
  const absolutePath = resolveProjectPath(projectRoot, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  return content.length > maxChars
    ? `${content.slice(0, maxChars)}\n\n... truncated ...`
    : content;
}

function readFile(projectRoot, filePath) {
  return readFileWithLimit(projectRoot, filePath, MAX_FILE_READ_CHARS);
}

function readFiles(projectRoot, paths = []) {
  const requestedPaths = Array.isArray(paths)
    ? [...new Set(paths.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];

  if (requestedPaths.length === 0) {
    throw new Error("At least one file path is required.");
  }

  if (requestedPaths.length > MAX_MULTI_READ_FILES) {
    throw new Error(`Too many files requested (${requestedPaths.length}). Limit is ${MAX_MULTI_READ_FILES}.`);
  }

  let remainingChars = MAX_MULTI_READ_TOTAL_CHARS;
  const files = [];

  for (const filePath of requestedPaths) {
    if (remainingChars <= 0) {
      files.push({
        path: filePath,
        truncated: true,
        content: "... omitted because the batched read reached the size limit ..."
      });
      continue;
    }

    try {
      const content = readFileWithLimit(projectRoot, filePath, Math.min(MAX_FILE_READ_CHARS, remainingChars));
      remainingChars -= content.length;
      files.push({
        path: filePath,
        content,
        truncated: content.endsWith("... truncated ...")
      });
    } catch (error) {
      files.push({
        path: filePath,
        error: error.message
      });
    }
  }

  return files;
}

function parseLineNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

async function readFileLines(projectRoot, filePath, options = {}) {
  const absolutePath = resolveProjectPath(projectRoot, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  const requestedStart = parseLineNumber(options.startLine);
  const requestedEnd = parseLineNumber(options.endLine);
  const startLine = Math.max(1, requestedStart ?? 1);
  let endLine = requestedEnd ?? (startLine + DEFAULT_READ_LINE_COUNT - 1);

  if (!Number.isInteger(endLine) || endLine < startLine) {
    endLine = startLine;
  }

  const maxEndLine = startLine + MAX_READ_LINE_COUNT - 1;
  const clamped = endLine > maxEndLine;
  if (clamped) {
    endLine = maxEndLine;
  }

  const stream = fs.createReadStream(absolutePath, {
    encoding: "utf8"
  });

  let buffer = "";
  let currentLine = 0;
  let totalChars = 0;
  let truncated = false;
  const outputLines = [];

  try {
    for await (const chunk of stream) {
      buffer += chunk;

      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) {
          break;
        }

        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        currentLine += 1;

        if (currentLine < startLine) {
          continue;
        }

        if (currentLine > endLine) {
          stream.destroy();
          break;
        }

        const cleanLine = rawLine.replace(/\r$/, "");
        const snippet = cleanLine.length > MAX_READ_LINE_CHARS
          ? `${cleanLine.slice(0, MAX_READ_LINE_CHARS)}...`
          : cleanLine;
        const numbered = `${currentLine}: ${snippet}`;
        outputLines.push(numbered);
        totalChars += numbered.length + 1;

        if (totalChars >= MAX_FILE_READ_CHARS) {
          truncated = true;
          stream.destroy();
          break;
        }
      }

      if (currentLine >= endLine || truncated) {
        break;
      }
    }

    // Flush last line when file does not end with a newline.
    if (!truncated && currentLine < endLine && buffer) {
      currentLine += 1;
      if (currentLine >= startLine && currentLine <= endLine) {
        const cleanLine = buffer.replace(/\r$/, "");
        const snippet = cleanLine.length > MAX_READ_LINE_CHARS
          ? `${cleanLine.slice(0, MAX_READ_LINE_CHARS)}...`
          : cleanLine;
        const numbered = `${currentLine}: ${snippet}`;
        outputLines.push(numbered);
        totalChars += numbered.length + 1;
        if (totalChars >= MAX_FILE_READ_CHARS) {
          truncated = true;
        }
      }
    }
  } finally {
    stream.destroy();
  }

  return {
    path: filePath,
    startLine,
    endLine,
    clamped,
    truncated,
    content: outputLines.join("\n")
  };
}

function readFileSnapshot(projectRoot, filePath) {
  const absolutePath = resolveProjectPath(projectRoot, filePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      path: filePath,
      exists: false,
      content: ""
    };
  }

  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  return {
    path: filePath,
    exists: true,
    content: fs.readFileSync(absolutePath, "utf8")
  };
}

function writeTempTextFile(filePath, content) {
  fs.writeFileSync(filePath, String(content ?? "").replace(/\r\n?/g, "\n"), "utf8");
}

function computeFallbackLineStats(beforeContent, afterContent) {
  const beforeLines = String(beforeContent ?? "").split(/\r?\n/);
  const afterLines = String(afterContent ?? "").split(/\r?\n/);

  return {
    addedLines: Math.max(afterLines.length - beforeLines.length, 0),
    deletedLines: Math.max(beforeLines.length - afterLines.length, 0)
  };
}

function computeFileChangeStats(filePath, beforeSnapshot, afterSnapshot) {
  const beforeExists = Boolean(beforeSnapshot?.exists);
  const afterExists = Boolean(afterSnapshot?.exists);
  const beforeContent = String(beforeSnapshot?.content ?? "");
  const afterContent = String(afterSnapshot?.content ?? "");

  if (beforeExists === afterExists && beforeContent === afterContent) {
    return null;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-diff-"));
  const beforeTempFile = path.join(tempDir, "before.txt");
  const afterTempFile = path.join(tempDir, "after.txt");

  try {
    writeTempTextFile(beforeTempFile, beforeContent);
    writeTempTextFile(afterTempFile, afterContent);

    const diffResult = spawnSync(
      "git",
      ["diff", "--no-index", "--numstat", "--no-renames", "--", beforeTempFile, afterTempFile],
      {
        encoding: "utf8",
        windowsHide: true
      }
    );
    const output = `${diffResult.stdout ?? ""}\n${diffResult.stderr ?? ""}`;
    const match = output.match(/^(\d+|-)\t(\d+|-)\t/m);
    const fallbackStats = computeFallbackLineStats(beforeContent, afterContent);
    const addedLines = match
      ? Number.parseInt(match[1] === "-" ? "0" : match[1], 10)
      : fallbackStats.addedLines;
    const deletedLines = match
      ? Number.parseInt(match[2] === "-" ? "0" : match[2], 10)
      : fallbackStats.deletedLines;

    const fullDiffResult = spawnSync(
      "git",
      ["diff", "--no-index", "--no-renames", "--color=never", "--", beforeTempFile, afterTempFile],
      {
        encoding: "utf8",
        windowsHide: true
      }
    );

    let diffText = (fullDiffResult.stdout || "").trim();
    if (diffText) {
      diffText = diffText
        .replace(new RegExp(beforeTempFile.replace(/\\/g, "\\\\"), "g"), `a/${filePath}`)
        .replace(new RegExp(afterTempFile.replace(/\\/g, "\\\\"), "g"), `b/${filePath}`);
    }

    return {
      path: filePath,
      status: !beforeExists ? "added" : !afterExists ? "deleted" : "modified",
      addedLines: Number.isNaN(addedLines) ? fallbackStats.addedLines : addedLines,
      deletedLines: Number.isNaN(deletedLines) ? fallbackStats.deletedLines : deletedLines,
      diff: diffText
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function normalizePatchPath(value, prefix) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed || trimmed === "/dev/null") {
    return "";
  }

  const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  return withoutPrefix.replace(/^"(.*)"$/, "$1").trim();
}

function parsePatchTouchedPaths(patchText) {
  const normalizedPatch = String(patchText ?? "").replace(/\r\n?/g, "\n");
  const touchedPaths = new Set();

  for (const line of normalizedPatch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const nextPath = normalizePatchPath(line.slice(4), "b/");
      if (nextPath) {
        touchedPaths.add(nextPath);
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      const nextPath = normalizePatchPath(line.slice(4), "a/");
      if (nextPath) {
        touchedPaths.add(nextPath);
      }
    }
  }

  return [...touchedPaths];
}

function writeFile(projectRoot, filePath, content) {
  const nextContent = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (nextContent.length > MAX_FILE_WRITE_CHARS) {
    throw new Error(`File content too large (${nextContent.length} chars).`);
  }

  const beforeSnapshot = readFileSnapshot(projectRoot, filePath);
  const absolutePath = resolveProjectPath(projectRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, nextContent, "utf8");
  const afterSnapshot = readFileSnapshot(projectRoot, filePath);
  const fileChange = computeFileChangeStats(filePath, beforeSnapshot, afterSnapshot);

  return {
    path: filePath,
    charsWritten: nextContent.length,
    filesChanged: fileChange ? [fileChange] : []
  };
}

function replaceText(projectRoot, filePath, oldString, newString) {
  const from = String(oldString ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const to = String(newString ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!from) {
    throw new Error("oldString is required.");
  }

  if (from.length > 50000) {
    throw new Error(`oldString is too large (${from.length} chars).`);
  }

  if (to.length > 50000) {
    throw new Error(`newString is too large (${to.length} chars).`);
  }

  const beforeSnapshot = readFileSnapshot(projectRoot, filePath);
  if (!beforeSnapshot.exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!beforeSnapshot.content.includes(from)) {
    throw new Error(`oldString not found in file: ${filePath}`);
  }

  const occurrences = beforeSnapshot.content.split(from).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `replaceText: oldString appears ${occurrences} times in ${filePath}. Provide a more unique string to avoid ambiguous replacement.`
    );
  }

  const nextContent = beforeSnapshot.content.replace(from, to);
  const absolutePath = resolveProjectPath(projectRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, nextContent, "utf8");

  const afterSnapshot = readFileSnapshot(projectRoot, filePath);
  const fileChange = computeFileChangeStats(filePath, beforeSnapshot, afterSnapshot);

  return {
    path: filePath,
    replaced: true,
    filesChanged: fileChange ? [fileChange] : []
  };
}

function applyPatch(projectRoot, patchText) {
  const normalizedPatch = String(patchText ?? "").replace(/\r\n?/g, "\n");

  if (!normalizedPatch.trim()) {
    throw new Error("Patch text is required.");
  }

  if (normalizedPatch.length > MAX_PATCH_CHARS) {
    throw new Error(`Patch content too large (${normalizedPatch.length} chars).`);
  }

  const touchedPaths = parsePatchTouchedPaths(normalizedPatch);

  if (touchedPaths.length === 0) {
    throw new Error("No file paths were found in the patch.");
  }

  const beforeSnapshots = new Map();

  for (const filePath of touchedPaths) {
    resolveProjectPath(projectRoot, filePath);
    beforeSnapshots.set(filePath, readFileSnapshot(projectRoot, filePath));
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-patch-"));
  const patchFile = path.join(tempDir, "change.patch");

  try {
    writeTempTextFile(patchFile, normalizedPatch);

    const checkResult = spawnSync(
      "git",
      ["apply", "--check", "--recount", "--whitespace=nowarn", patchFile],
      {
        cwd: projectRoot,
        encoding: "utf8",
        windowsHide: true
      }
    );

    if (checkResult.status !== 0) {
      throw new Error(
        String(checkResult.stderr || checkResult.stdout || "Patch does not apply cleanly.").trim()
      );
    }

    const applyResult = spawnSync(
      "git",
      ["apply", "--recount", "--whitespace=nowarn", patchFile],
      {
        cwd: projectRoot,
        encoding: "utf8",
        windowsHide: true
      }
    );

    if (applyResult.status !== 0) {
      throw new Error(
        String(applyResult.stderr || applyResult.stdout || "Patch failed to apply.").trim()
      );
    }

    const filesChanged = touchedPaths
      .map((filePath) =>
        computeFileChangeStats(
          filePath,
          beforeSnapshots.get(filePath),
          readFileSnapshot(projectRoot, filePath)
        )
      )
      .filter(Boolean);

    return {
      ok: true,
      action: "apply_patch",
      fileCount: filesChanged.length,
      filesChanged
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runCommand(projectRoot, command) {
  const safeCommand = validateCommand(command);
  try {
    const { stdout, stderr } = await execAsync(safeCommand, {
      cwd: projectRoot,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });

    return {
      command: safeCommand,
      ok: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    return {
      command: safeCommand,
      ok: false,
      exitCode: Number.isInteger(error.code) ? error.code : 1,
      stdout: (error.stdout ?? "").trim(),
      stderr: (error.stderr ?? error.message ?? "").trim()
    };
  }
}

function normalizeSingleRequestObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const action = String(raw.action ?? raw.tool ?? "").trim();

  if (!action) {
    return null;
  }

  return {
    action,
    reason: String(raw.reason ?? "").trim(),
    agent: raw.agent ? String(raw.agent).trim() : undefined,
    agentId: raw.agentId ? String(raw.agentId).trim() : undefined,
    pattern: raw.pattern ? String(raw.pattern).trim() : undefined,
    path: raw.path ? String(raw.path).trim() : undefined,
    startLine: parseLineNumber(raw.startLine) ?? undefined,
    endLine: parseLineNumber(raw.endLine) ?? undefined,
    oldString: raw.oldString !== undefined ? String(raw.oldString) : undefined,
    newString: raw.newString !== undefined ? String(raw.newString) : undefined,
    paths: Array.isArray(raw.paths)
      ? [...new Set(raw.paths.map((item) => String(item ?? "").trim()).filter(Boolean))]
      : undefined,
    dir: raw.dir ? String(raw.dir).trim() : undefined,
    cmd: raw.cmd ? String(raw.cmd).trim() : undefined,
    task: raw.task ? String(raw.task).trim() : undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    patch: typeof raw.patch === "string" ? raw.patch : undefined,
    assignments: Array.isArray(raw.assignments)
      ? raw.assignments
          .map((assignment) => ({
            agent: assignment?.agent ? String(assignment.agent).trim() : "",
            agentId: assignment?.agentId ? String(assignment.agentId).trim() : "",
            task: assignment?.task ? String(assignment.task).trim() : ""
          }))
          .filter((assignment) => (assignment.agent || assignment.agentId) && assignment.task)
      : undefined,
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((entry) => normalizeSingleRequestObject(entry)).filter(Boolean)
      : undefined
  };
}

function normalizeRequestObject(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (Array.isArray(raw)) {
    const actions = raw.map((entry) => normalizeSingleRequestObject(entry)).filter(Boolean);

    if (actions.length === 0) {
      return null;
    }

    return actions.length === 1
      ? actions[0]
      : {
          action: "batch_actions",
          reason: "",
          actions
        };
  }

  const normalized = normalizeSingleRequestObject(raw);

  if (!normalized) {
    return null;
  }

  if (normalized.action === "batch_actions") {
    if (!normalized.actions?.length) {
      return null;
    }

    return normalized;
  }

  return normalized;
}

function extractBalancedJsonValue(text, searchOffset = 0) {
  const source = String(text ?? "");
  if (searchOffset >= source.length) {
    return null;
  }

  const objectIndex = source.indexOf("{", searchOffset);
  const arrayIndex = source.indexOf("[", searchOffset);
  let startIndex = -1;

  if (objectIndex === -1) {
    startIndex = arrayIndex;
  } else if (arrayIndex === -1) {
    startIndex = objectIndex;
  } else {
    startIndex = Math.min(objectIndex, arrayIndex);
  }

  if (startIndex === -1) {
    return null;
  }

  const opening = source[startIndex];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;

      if (depth === 0) {
        return {
          value: source.slice(startIndex, index + 1),
          startIndex,
          endIndex: index + 1
        };
      }
    }
  }

  // If we found an opening bracket but it never closed, 
  // we must return null so tryParseRequest can look past THIS opening bracket.
  return {
    value: null,
    startIndex,
    endIndex: startIndex + 1
  };
}

function tryParseRequest(candidateText) {
  if (!candidateText || !candidateText.trim()) {
    return null;
  }

  const text = candidateText.trim();

  // 1. Try to parse the entire trimmed text as JSON (common for clean API responses)
  try {
    const parsed = JSON.parse(text);
    const normalized = normalizeRequestObject(parsed);
    if (normalized) return normalized;
  } catch {
    // Not a single JSON block, fall back to extraction
  }

  // 2. Sequentially search for balanced blocks and try to parse them
  let currentOffset = 0;
  while (currentOffset < text.length) {
    const result = extractBalancedJsonValue(text, currentOffset);
    if (!result) {
      break;
    }

    if (result.value) {
      // Clean the potential JSON block:
      // Strip common line number patterns (e.g. "1 {", "2   ")
      // and other garbage that innerText() often picks up from formatted code blocks.
      const cleaned = result.value
        .split("\n")
        .map((line) => line.replace(/^\s*\d+\s+/, "")) // Strip leading line numbers
        .join("\n")
        .trim();

      try {
        const parsed = JSON.parse(cleaned);
        const normalized = normalizeRequestObject(parsed);
        if (normalized) {
          return normalized;
        }
      } catch {
        // Not valid JSON, even after cleaning
      }
    }

    // Advance past the start of the block we just tried (even if it wasn't balanced or valid)
    currentOffset = result.startIndex + 1;
  }

  return null;
}

export function parseToolRequest(responseText) {
  const text = String(responseText ?? "").trim();
  
  if (!text) {
    return null;
  }

  const patterns = [
    /```hydra(?:-tool)?\s*([\s\S]*?)```/gi,
    /```json\s*([\s\S]*?"action"[\s\S]*?)```/gi,
    /```(?:[a-z]*)?\s*([\s\S]*?"action"[\s\S]*?)```/gi,
    /(?:^|\n)\s*hydra(?:-tool)?\s*([\[{][\s\S]*)$/gi,
    /(?:^|\n)\s*hydra(?:-tool)?\s*\n([\s\S]*)$/gi
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);

    for (const match of matches) {
      const normalized = tryParseRequest(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }

  const fallback = tryParseRequest(text);
  if (fallback) {
    return fallback;
  }

  // Final loose attempt: look for anything that looks like "action":"..."
  if (text.includes('"action"') || text.includes("'action'")) {
    console.info("[Hydra] Detected potential tool call in text but failed to parse. Output was:\n" + text.slice(0, 500));
  }

  return null;
}

function summarizeRequest(request) {
  switch (request.action) {
    case "list_files":
      return `List files in ${request.dir || "."}`;
    case "search_files":
      return `Search files in ${request.dir || "."} for ${request.pattern}`;
    case "read_files":
      return `Read ${request.paths?.length || 0} files`;
    case "read_file":
      return `Read file ${request.path}`;
    case "read_file_lines":
      return `Read lines ${request.startLine || "?"}-${request.endLine || "?"} from ${request.path}`;
    case "write_file":
      return `Write file ${request.path}`;
    case "replace":
      return `Replace text in ${request.path}`;
    case "apply_patch":
      return "Apply a unified diff patch";
    case "batch_actions":
      return `Run ${request.actions?.length || 0} batched read-only actions`;
    case "run_command":
      return `Run command: ${request.cmd}`;
    case "delegate_task":
      return `Delegate task to ${request.agent || request.agentId}`;
    case "delegate_tasks":
      return `Delegate ${request.assignments?.length || 0} tasks in parallel`;
    case "rebuild_app":
      return "Rebuild the app";
    case "reload_app":
      return "Reload the app window";
    case "restart_app":
      return "Restart the app";
    default:
      return `${request.action}`;
  }
}

export async function requestToolApproval({
  agent,
  request,
  projectRoot,
  approvalMode
}) {
  if (approvalMode === "auto") {
    return true;
  }

  const detailLines = [
    `Agent: ${agent.name} (${agent.platform}, ${agent.role})`,
    `Project root: ${projectRoot}`,
    `Action: ${request.action}`,
    request.reason ? `Reason: ${request.reason}` : null,
    request.path ? `Path: ${request.path}` : null,
    request.startLine || request.endLine
      ? `Lines: ${request.startLine || "?"}-${request.endLine || "?"}`
      : null,
    request.oldString !== undefined
      ? `Old string (${String(request.oldString).length} chars): ${trimSnippet(request.oldString, 200)}`
      : null,
    request.newString !== undefined
      ? `New string (${String(request.newString).length} chars): ${trimSnippet(request.newString, 200)}`
      : null,
    request.patch ? `Patch size: ${request.patch.length} chars` : null,
    request.dir ? `Dir: ${request.dir}` : null,
    request.pattern ? `Pattern: ${request.pattern}` : null,
    request.cmd ? `Command: ${request.cmd}` : null,
    request.paths?.length ? `Paths:\n${request.paths.map((entry) => `- ${entry}`).join("\n")}` : null,
    request.actions?.length
      ? `Batched actions:\n${request.actions
          .map((entry) => `- ${summarizeRequest(entry)}`)
          .join("\n")}`
      : null,
    request.agent ? `Worker: ${request.agent}` : null,
    request.agentId ? `Worker ID: ${request.agentId}` : null,
    request.task ? `Task: ${request.task}` : null,
    request.assignments?.length
      ? `Assignments:\n${request.assignments
          .map((assignment) => `- ${assignment.agent || assignment.agentId}: ${assignment.task}`)
          .join("\n")}`
      : null
  ].filter(Boolean);

  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Approve", "Reject"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Hydra Tool Request",
    message: summarizeRequest(request),
    detail: detailLines.join("\n")
  });

  return result.response === 0;
}

async function executeReadOnlyToolRequest(projectRoot, request) {
  switch (request.action) {
    case "list_files":
      return {
        ok: true,
        action: request.action,
        dir: request.dir || ".",
        output: listFiles(projectRoot, request.dir || ".", 3)
      };

    case "search_files":
      return {
        ok: true,
        action: request.action,
        dir: request.dir || ".",
        pattern: request.pattern || "",
        output: await searchFiles(projectRoot, request.pattern, request.dir || ".")
      };

    case "read_file":
      return {
        ok: true,
        action: request.action,
        path: request.path,
        content: readFile(projectRoot, request.path)
      };

    case "read_file_lines": {
      const result = await readFileLines(projectRoot, request.path, {
        startLine: request.startLine,
        endLine: request.endLine
      });

      return {
        ok: true,
        action: request.action,
        ...result
      };
    }

    case "read_files":
      return {
        ok: true,
        action: request.action,
        files: readFiles(projectRoot, request.paths)
      };

    default:
      throw new Error(`Unsupported read-only Hydra action "${request.action}".`);
  }
}

export async function executeToolRequest(projectRoot, request, options = {}) {
  switch (request.action) {
    case "list_files":
    case "search_files":
    case "read_file":
    case "read_file_lines":
    case "read_files":
      return executeReadOnlyToolRequest(projectRoot, request);

    case "write_file":
      return {
        ok: true,
        action: request.action,
        ...writeFile(projectRoot, request.path, request.content)
      };

    case "replace":
      return {
        ok: true,
        action: request.action,
        ...replaceText(projectRoot, request.path, request.oldString, request.newString)
      };

    case "apply_patch":
      return applyPatch(projectRoot, request.patch);

    case "batch_actions": {
      const actions = Array.isArray(request.actions) ? request.actions : [];

      if (actions.length === 0) {
        throw new Error("batch_actions requires at least one sub-action.");
      }

      if (actions.length > MAX_BATCH_ACTIONS) {
        throw new Error(`Too many batched actions (${actions.length}). Limit is ${MAX_BATCH_ACTIONS}.`);
      }

      for (const entry of actions) {
        if (!READ_ONLY_BATCH_ACTIONS.has(entry.action)) {
          throw new Error(`Action "${entry.action}" is not allowed inside batch_actions.`);
        }
      }

      const results = [];

      for (const entry of actions) {
        results.push(await executeReadOnlyToolRequest(projectRoot, entry));
      }

      return {
        ok: true,
        action: request.action,
        results
      };
    }

    case "run_command":
      return {
        action: request.action,
        ...(await runCommand(projectRoot, request.cmd))
      };

    case "delegate_task":
      if (typeof options.delegateTask !== "function") {
        throw new Error("Delegation is not available in this runtime.");
      }

      return options.delegateTask(request);

    case "delegate_tasks":
      if (typeof options.delegateTasks !== "function") {
        throw new Error("Batch delegation is not available in this runtime.");
      }

      return options.delegateTasks(request);

    case "rebuild_app":
      if (typeof options.rebuildApp !== "function") {
        throw new Error("App rebuild is not available in this runtime.");
      }

      return options.rebuildApp(request);

    case "reload_app":
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.reloadIgnoringCache();
      });

      return {
        ok: true,
        action: request.action,
        reloadedWindows: BrowserWindow.getAllWindows().length
      };

    case "restart_app":
      if (typeof options.scheduleRestart !== "function") {
        throw new Error("App restart is not available in this runtime.");
      }

      return options.scheduleRestart(request);

    default:
      throw new Error(`Unsupported Hydra action "${request.action}".`);
  }
}

function formatReadFilesResult(request, result) {
  return [
    "[HYDRA_TOOL_RESULT]",
    `The requested action "${request.action}" has completed.`,
    "Use the grouped file contents below. Do not request the same files again unless a result explicitly failed.",
    "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
    "If you are done, answer normally for the user.",
    ...result.files.flatMap((file) => {
      if (file.error) {
        return [
          `[FILE ${file.path}]`,
          `Error: ${file.error}`
        ];
      }

      return [
        `[FILE ${file.path}]`,
        "```text",
        String(file.content ?? ""),
        "```"
      ];
    })
  ].join("\n");
}

function formatBatchActionsResult(result) {
  const sections = [
    "[HYDRA_TOOL_RESULT]",
    'The requested action "batch_actions" has completed.',
    "Use the grouped discovery results below. Do not repeat the same reads/searches unless a result explicitly failed.",
    "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
    "If you are done, answer normally for the user."
  ];

  result.results.forEach((entry, index) => {
    sections.push("");
    sections.push(`[BATCH RESULT ${index + 1}] ${entry.action}`);

    if (entry.action === "read_file") {
      sections.push(`Path: ${entry.path}`);
      sections.push("```text");
      sections.push(String(entry.content ?? ""));
      sections.push("```");
      return;
    }

    if (entry.action === "read_file_lines") {
      sections.push(`Path: ${entry.path}`);
      sections.push(`Lines: ${entry.startLine || "?"}-${entry.endLine || "?"}`);
      if (entry.clamped) {
        sections.push("(Requested range clamped to limit.)");
      }
      if (entry.truncated) {
        sections.push("(Output truncated to size limit.)");
      }
      sections.push("```text");
      sections.push(String(entry.content ?? ""));
      sections.push("```");
      return;
    }

    if (entry.action === "read_files") {
      entry.files.forEach((file) => {
        sections.push(`[FILE ${file.path}]`);
        if (file.error) {
          sections.push(`Error: ${file.error}`);
        } else {
          sections.push("```text");
          sections.push(String(file.content ?? ""));
          sections.push("```");
        }
      });
      return;
    }

    if (entry.action === "list_files" || entry.action === "search_files") {
      if (entry.dir) {
        sections.push(`Directory: ${entry.dir}`);
      }
      if (entry.pattern) {
        sections.push(`Pattern: ${entry.pattern}`);
      }
      sections.push("```text");
      sections.push(String(entry.output ?? ""));
      sections.push("```");
      return;
    }

    sections.push("```json");
    sections.push(JSON.stringify(entry, null, 2));
    sections.push("```");
  });

  return sections.join("\n");
}

export function formatToolResultPrompt(request, result) {
  const successLine = result?.ok
    ? "The action succeeded. Do not repeat the same request unless the result explicitly shows it failed."
    : "The action failed. You may request a different safer action or explain the blocker.";
  const nextStepLine =
    request.action === "write_file" || request.action === "apply_patch" || request.action === "replace"
      ? "If the file write succeeded, summarize the change or continue with the next distinct step instead of rewriting the same file again."
      : request.action === "read_file"
      ? "You already have the file content below. Do not request the same file again unless this result explicitly failed."
      : request.action === "read_file_lines"
      ? "You already have the requested file lines below. Do not request the same range again unless this result explicitly failed."
      : request.action === "read_files"
      ? "You already have the grouped file contents below. Continue from them instead of reading the same files one by one."
      : request.action === "list_files"
      ? "You already have the directory listing below. Choose a different file or answer normally instead of listing the same directory again."
      : request.action === "batch_actions"
      ? "Use the grouped discovery results below. Choose the next distinct step instead of replaying the same discovery actions."
      : request.action === "delegate_task" || request.action === "delegate_tasks"
      ? "Use the returned worker output to continue orchestration. Only delegate again if a new subtask is needed."
      : request.action === "restart_app"
      ? "A full app restart ends this run. Summarize the outcome for the user instead of expecting automatic continuation after relaunch."
      : request.action === "rebuild_app" || request.action === "reload_app"
      ? "If build or restart succeeded, continue with validation or summarize the outcome for the user."
      : "If you already have enough information, answer normally for the user instead of calling Hydra again.";

  if (request.action === "read_file" && result?.ok) {
    return [
      "[HYDRA_TOOL_RESULT]",
      `The requested action "${request.action}" has completed.`,
      successLine,
      nextStepLine,
      `Path: ${result.path || request.path || "(unknown)"}`,
      "The file content is below as raw text:",
      "```text",
      String(result.content ?? ""),
      "```",
      "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
      "If you are done, answer normally for the user."
    ].join("\n");
  }

  if (request.action === "read_file_lines" && result?.ok) {
    const rangeLine = `Lines: ${result.startLine || request.startLine || "?"}-${result.endLine || request.endLine || "?"}`;
    const notes = [];
    if (result.clamped) {
      notes.push("(Requested range clamped to limit.)");
    }
    if (result.truncated) {
      notes.push("(Output truncated to size limit.)");
    }

    return [
      "[HYDRA_TOOL_RESULT]",
      `The requested action "${request.action}" has completed.`,
      successLine,
      nextStepLine,
      `Path: ${result.path || request.path || "(unknown)"}`,
      rangeLine,
      ...notes,
      "The requested file lines are below as raw text:",
      "```text",
      String(result.content ?? ""),
      "```",
      "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
      "If you are done, answer normally for the user."
    ].join("\n");
  }

  if (request.action === "list_files" && result?.ok) {
    return [
      "[HYDRA_TOOL_RESULT]",
      `The requested action "${request.action}" has completed.`,
      successLine,
      nextStepLine,
      `Directory: ${result.dir || request.dir || "."}`,
      "The directory listing is below as raw text:",
      "```text",
      String(result.output ?? ""),
      "```",
      "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
      "If you are done, answer normally for the user."
    ].join("\n");
  }

  if (request.action === "search_files" && result?.ok) {
    return [
      "[HYDRA_TOOL_RESULT]",
      `The requested action "${request.action}" has completed.`,
      successLine,
      "Use these search results to choose the most relevant file. Do not search for the same pattern in the same directory again unless the result failed.",
      `Directory: ${result.dir || request.dir || "."}`,
      `Pattern: ${result.pattern || request.pattern || ""}`,
      "The search output is below as raw text:",
      "```text",
      String(result.output ?? ""),
      "```",
      "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
      "If you are done, answer normally for the user."
    ].join("\n");
  }

  if (request.action === "read_files" && result?.ok) {
    return formatReadFilesResult(request, result);
  }

  if (request.action === "batch_actions" && result?.ok) {
    return formatBatchActionsResult(result);
  }

  return [
    "[HYDRA_TOOL_RESULT]",
    `The requested action "${request.action}" has completed.`,
    "Use the JSON result below.",
    successLine,
    nextStepLine,
    "If you need another PC action, respond with exactly one ```hydra``` JSON block.",
    "If you are done, answer normally for the user.",
    "```json",
    JSON.stringify(result, null, 2),
    "```"
  ].join("\n");
}

export function formatRejectedToolPrompt(request) {
  return [
    "[HYDRA_TOOL_RESULT]",
    `The user rejected the requested action "${request.action}".`,
    "Do not assume the action was executed.",
    "Choose a safer alternative, ask for a different action, or explain what you need next."
  ].join("\n");
}

export function formatRepeatedToolResultPrompt(request, result, repeatCount) {
  return [
    "[HYDRA_TOOL_RESULT]",
    `Hydra already completed the exact action "${request.action}" ${repeatCount - 1} time(s) in this same task.`,
    "Do not request the same action again.",
    "Use the cached result below and continue with a different action or answer normally.",
    result?.ok
      ? "Treat the previous result as final for this task and choose the next distinct step."
      : "The previous result failed, so choose a different safer action or explain the blocker.",
    "Cached result:",
    "```json",
    JSON.stringify(result, null, 2),
    "```"
  ].join("\n");
}
