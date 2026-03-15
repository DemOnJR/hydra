import { Router } from "express";
import { getSessionById, getSessionLogs, listSessions } from "../db/queries.js";
import {
  setOrchestratorDecision,
  startOrchestratorSession
} from "../orchestrator/sessionRunner.js";

const router = Router();

router.get("/", (req, res) => {
  const projectId = req.query.projectId?.toString() || null;
  const limit = Number.parseInt(req.query.limit?.toString() || "25", 10);

  res.json(listSessions(projectId, Number.isNaN(limit) ? 25 : limit));
});

router.get("/recent", (req, res) => {
  const projectId = req.query.projectId?.toString() || null;
  const limit = Number.parseInt(req.query.limit?.toString() || "25", 10);

  res.json({
    items: listSessions(projectId, Number.isNaN(limit) ? 25 : limit)
  });
});

router.post("/start", async (req, res) => {
  const { projectId, maxCycles, dryRun = false } = req.body ?? {};
  const parsedMaxCycles =
    maxCycles === undefined ? undefined : Number.parseInt(String(maxCycles), 10);

  if (!projectId) {
    res.status(400).json({ error: "projectId is required." });
    return;
  }

  try {
    const session = await startOrchestratorSession(projectId, {
      maxCycles: Number.isNaN(parsedMaxCycles) ? undefined : parsedMaxCycles,
      dryRun: Boolean(dryRun)
    });
    res.status(202).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/:id", (req, res) => {
  const session = getSessionById(req.params.id);

  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  res.json(session);
});

router.get("/:id/logs", (req, res) => {
  const limit = Number.parseInt(req.query.limit?.toString() || "200", 10);
  res.json(getSessionLogs(req.params.id, Number.isNaN(limit) ? 200 : limit));
});

router.patch("/:id/decision", async (req, res) => {
  const { decision } = req.body ?? {};

  if (!decision) {
    res.status(400).json({ error: "decision is required." });
    return;
  }

  try {
    const session = await setOrchestratorDecision(req.params.id, decision);
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
