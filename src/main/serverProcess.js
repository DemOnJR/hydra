import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getServerBaseUrl } from "./serverClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serverProcess;

function resolveNodeExecutable() {
  const candidates = [
    process.env.AGENTSYNC_NODE_PATH,
    process.env.npm_node_execpath,
    process.env.NODE,
    "node"
  ].filter(Boolean);

  return candidates[0];
}

async function waitForServer(timeoutMs = 10000) {
  const startedAt = Date.now();
  const url = `${getServerBaseUrl()}/health`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error("Context server failed to start.");
}

export async function startContextServer() {
  if (process.env.AGENTSYNC_EXTERNAL_SERVER === "1") {
    return;
  }

  if (serverProcess) {
    return;
  }

  const entryPath = path.join(__dirname, "../../server/index.js");
  const nodeExecutable = resolveNodeExecutable();

  serverProcess = spawn(nodeExecutable, [entryPath], {
    stdio: "inherit",
    env: process.env
  });

  serverProcess.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[Context Server] exited with code ${code}`);
    }

    serverProcess = undefined;
  });

  await waitForServer();
}

export function stopContextServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
}
