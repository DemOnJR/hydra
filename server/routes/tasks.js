import { Router } from "express";
import {
  completeTask,
  createTask,
  getRecentTasks,
  updateTaskStatus
} from "../db/queries.js";

const router = Router();

router.get("/", (req, res) => {
  const projectId = req.query.projectId?.toString() || null;
  const limit = Number.parseInt(req.query.limit?.toString() || "50", 10);
  res.json(getRecentTasks(projectId, Number.isNaN(limit) ? 50 : limit));
});

router.post("/", (req, res) => {
  const { projectId = null, agentId, prompt, userTask } = req.body ?? {};

  if (!agentId || !prompt || !userTask) {
    res
      .status(400)
      .json({ error: "agentId, prompt, and userTask are required." });
    return;
  }

  const task = createTask({ projectId, agentId, prompt, userTask });
  res.status(201).json(task);
});

router.patch("/:id/status", (req, res) => {
  const { status } = req.body ?? {};

  if (!status) {
    res.status(400).json({ error: "Task status is required." });
    return;
  }

  res.json(updateTaskStatus(req.params.id, status));
});

router.patch("/:id/complete", (req, res) => {
  const { response = "" } = req.body ?? {};
  res.json(completeTask(req.params.id, response));
});

export default router;

