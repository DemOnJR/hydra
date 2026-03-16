import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    apply: flags.has("--apply"),
    force: flags.has("--force"),
    all: flags.has("--all"),
    base: (() => {
      const idx = argv.indexOf("--base");
      return idx >= 0 ? argv[idx + 1] : "";
    })()
  };
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true
  });
  return stdout.trim();
}

async function detectBaseBranch(cwd, preferred) {
  if (preferred?.trim()) return preferred.trim();
  const candidates = ["main", "master", "develop"];
  for (const name of candidates) {
    try {
      await git(["rev-parse", "--verify", name], cwd);
      return name;
    } catch {
      // ignore
    }
  }
  return "main";
}

function shouldConsiderBranch(name, { all }) {
  if (all) return true;
  return (
    name.startsWith("feature/") ||
    name.startsWith("fix/") ||
    name.startsWith("refactor/") ||
    name.startsWith("hydra/")
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const currentBranch = await git(["branch", "--show-current"], cwd);
  const base = await detectBaseBranch(cwd, opts.base);

  const mergedRaw = await git(["branch", "--merged", base], cwd);
  const merged = mergedRaw
    .split("\n")
    .map((line) => line.replace(/^\*\s+/, "").trim())
    .filter(Boolean);

  const protectedBranches = new Set([base, currentBranch, "HEAD"]);
  const candidates = merged
    .filter((name) => !protectedBranches.has(name))
    .filter((name) => shouldConsiderBranch(name, opts));

  if (candidates.length === 0) {
    console.log(`[cleanup-branches] No merged branches to clean (base: ${base}).`);
    return;
  }

  console.log(`[cleanup-branches] Base: ${base}`);
  console.log(`[cleanup-branches] Current: ${currentBranch || "(detached)"}`);
  console.log(`[cleanup-branches] Candidates (${candidates.length}):`);
  for (const name of candidates) {
    console.log(`- ${name}`);
  }

  if (!opts.apply) {
    console.log("\nDry run. Re-run with --apply to delete these local branches.");
    return;
  }

  const deleteFlag = opts.force ? "-D" : "-d";
  for (const name of candidates) {
    try {
      await git(["branch", deleteFlag, name], cwd);
      console.log(`[cleanup-branches] Deleted ${name}`);
    } catch (error) {
      console.warn(`[cleanup-branches] Failed to delete ${name}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error("[cleanup-branches]", error.message);
  process.exitCode = 1;
});
