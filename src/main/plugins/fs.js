import fs from "node:fs";
import path from "node:path";

// Helper functions (moved from toolBridge.js)
const MAX_FILE_READ_CHARS = 120000;
const MAX_LIST_ENTRIES = 150;
const MAX_SEARCH_MATCHES = 120;
const MAX_MULTI_READ_FILES = 8;
const MAX_MULTI_READ_TOTAL_CHARS = 160000;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo"
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

// Tool Definitions

export const listFilesTool = {
  name: "list_files",
  description: "List files in a directory.",
  schema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "The directory to list." },
      maxDepth: { type: "number", description: "Maximum recursion depth." }
    }
  },
  execute: async (projectRoot, { dir = ".", maxDepth = 3 }) => {
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

    return {
      ok: true,
      action: "list_files",
      dir: dir || ".",
      output: lines.length >= MAX_LIST_ENTRIES
        ? `${lines.join("\n")}\n... truncated ...`
        : lines.join("\n") || "(no files)"
    };
  }
};

export const searchFilesTool = {
  name: "search_files",
  description: "Search files for a pattern.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The pattern to search for." },
      dir: { type: "string", description: "The directory to search in." }
    },
    required: ["pattern"]
  },
  execute: async (projectRoot, { pattern, dir = "." }) => {
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
              `${path.relative(root, absolutePath)}:${index + 1}: ${line.trim().slice(0, 300)}`
            );
          }

          if (matches.length >= MAX_SEARCH_MATCHES) {
            return;
          }
        }
      }
    }

    walk(startDir);

    return {
      ok: true,
      action: "search_files",
      dir: dir || ".",
      pattern: pattern || "",
      output: matches.length ? matches.join("\n") : "(no matches)"
    };
  }
};

export const readFileTool = {
  name: "read_file",
  description: "Read a file's content.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to read." }
    },
    required: ["path"]
  },
  execute: async (projectRoot, { path: filePath }) => {
    const absolutePath = resolveProjectPath(projectRoot, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    if (!fs.statSync(absolutePath).isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const result = content.length > MAX_FILE_READ_CHARS
      ? `${content.slice(0, MAX_FILE_READ_CHARS)}\n\n... truncated ...`
      : content;

    return {
      ok: true,
      action: "read_file",
      path: filePath,
      content: result
    };
  }
};

// Exporting as an array for auto-registration
export default [listFilesTool, searchFilesTool, readFileTool];
