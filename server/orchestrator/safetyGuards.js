import path from "node:path";

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

export function validateCommand(command) {
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

export function resolveProjectPath(projectRoot, targetPath = ".") {
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
