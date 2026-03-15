import "dotenv/config";
import cors from "cors";
import { pathToFileURL } from "node:url";
import express from "express";
import { loadApiKeys } from "./ai/keyManager.js";
import { closeDb, initDb } from "./db/schema.js";
import { shutdownSessions } from "./orchestrator/sessionRunner.js";
import agentsRouter from "./routes/agents.js";
import aiRouter from "./routes/ai.js";
import browserBridgeRouter from "./routes/browserBridge.js";
import contextRouter from "./routes/context.js";
import projectsRouter from "./routes/projects.js";
import sessionsRouter from "./routes/sessions.js";
import settingsRouter from "./routes/settings.js";
import tasksRouter from "./routes/tasks.js";
import todosRouter from "./routes/todos.js";
import { registerMcpRoutes } from "./mcp.js";

const HOST = process.env.CONTEXT_SERVER_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.CONTEXT_SERVER_PORT || "3847", 10);
const LOCAL_SECRET = process.env.LOCAL_SECRET?.trim();
let serverInstance;

function authorizeRequest(req, res) {
  if (!LOCAL_SECRET) {
    return true;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token === LOCAL_SECRET) {
    return true;
  }

  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function buildServer() {
  initDb();
  void loadApiKeys().catch((error) => {
    console.warn(`[AI] API key preload failed: ${error.message}`);
  });

  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (
          !origin ||
          origin === "null" ||
          /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
          /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
          /^http:\/\/localhost:\d+$/.test(origin)
        ) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin not allowed by local policy."));
      }
    })
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", (req, res, next) => {
    if (!authorizeRequest(req, res)) {
      return;
    }

    next();
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/context", contextRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/browser-bridge", browserBridgeRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/todos", todosRouter);

  registerMcpRoutes(app, authorizeRequest);

  return app;
}

export function startServer() {
  if (serverInstance) {
    return serverInstance;
  }

  const app = buildServer();
  serverInstance = app.listen(PORT, HOST, () => {
    console.log(`[Context Server] Listening at http://${HOST}:${PORT}`);
  });

  return serverInstance;
}

export function stopServer(callback) {
  Promise.resolve()
    .then(() => shutdownSessions())
    .catch((error) => {
      console.error("[Orchestrator] Session shutdown failed", error);
    })
    .finally(() => {
      if (!serverInstance) {
        closeDb();
        callback?.();
        return;
      }

      serverInstance.close(() => {
        serverInstance = undefined;
        closeDb();
        callback?.();
      });
    });
}

function shutdown() {
  stopServer(() => {
    process.exit(0);
  });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  startServer();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
