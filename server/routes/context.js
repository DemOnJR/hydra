import { Router } from "express";
import {
  deleteDecision,
  getAllAgents,
  getProjectCompaction,
  getProjectConversationSessions,
  getProjectConversationTurns,
  getPendingTodos,
  getProjectById,
  getProjectContext,
  getRecentDecisions,
  refreshProjectCompaction,
  saveDecision,
  saveDecisions,
  updateProjectContext
} from "../db/queries.js";

const router = Router();

router.get("/:projectId", (req, res) => {
  const projectId = req.params.projectId;
  const compaction = refreshProjectCompaction(projectId);

  res.json({
    project: getProjectById(projectId),
    context: getProjectContext(projectId),
    decisions: getRecentDecisions(projectId, 50),
    todos: getPendingTodos(projectId, 50),
    memory: compaction,
    history: {
      orchestrator: getProjectConversationSessions(projectId, {
        channel: "orchestrator",
        limit: 8
      }),
      workers: getProjectConversationSessions(projectId, {
        channel: "worker",
        limit: 8
      })
    },
    agents: getAllAgents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      platform: agent.platform,
      role: agent.role,
      status: agent.status,
      specialty: agent.specialty || ""
    }))
  });
});

router.get("/:projectId/history", (req, res) => {
  const projectId = req.params.projectId;
  const limit = Number.parseInt(req.query.limit?.toString() || "20", 10);
  const safeLimit = Number.isNaN(limit) ? 20 : limit;

  res.json({
    memory: refreshProjectCompaction(projectId),
    sessions: getProjectConversationSessions(projectId, {
      limit: safeLimit
    }),
    orchestratorTurns: getProjectConversationTurns(projectId, {
      channel: "orchestrator",
      limit: safeLimit
    }),
    workerTurns: getProjectConversationTurns(projectId, {
      channel: "worker",
      limit: safeLimit
    })
  });
});

router.put("/:projectId", (req, res) => {
  const nextContext = updateProjectContext(req.params.projectId, req.body ?? {});
  res.json(nextContext);
});

router.post("/:projectId/decisions", (req, res) => {
  const { title, content, category } = req.body ?? {};

  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "Decision title and content are required." });
    return;
  }

  const decision = saveDecision(req.params.projectId, {
    title: title.trim(),
    content: content.trim(),
    category
  });

  res.status(201).json(decision);
});

router.post("/:projectId/decisions/bulk", (req, res) => {
  const { decisions } = req.body ?? {};

  if (!Array.isArray(decisions) || decisions.length === 0) {
    res.status(400).json({ error: "decisions must be a non-empty array." });
    return;
  }

  const saved = saveDecisions(req.params.projectId, decisions);
  res.status(201).json(saved);
});

router.delete("/:projectId/decisions/:decisionId", (req, res) => {
  deleteDecision(req.params.decisionId);
  res.status(204).end();
});

export default router;
