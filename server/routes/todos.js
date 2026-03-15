import { Router } from "express";
import {
  createTodo,
  deleteTodo,
  getProjectTodos,
  updateTodoStatus
} from "../db/queries.js";

const router = Router();

router.get("/", (req, res) => {
  const projectId = req.query.projectId?.toString();
  const status = req.query.status?.toString();

  if (!projectId) {
    res.status(400).json({ error: "projectId is required." });
    return;
  }

  try {
    res.json(
      getProjectTodos(projectId, {
        status,
        limit: 100
      })
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  const { projectId, title, description = "", priority = "medium" } = req.body ?? {};

  if (!projectId || !title?.trim()) {
    res.status(400).json({ error: "projectId and title are required." });
    return;
  }

  res.status(201).json(
    createTodo({
      projectId,
      title: title.trim(),
      description: description.trim(),
      priority
    })
  );
});

router.patch("/:id", (req, res) => {
  const { status } = req.body ?? {};

  if (!status) {
    res.status(400).json({ error: "status is required." });
    return;
  }

  try {
    const todo = updateTodoStatus(req.params.id, status);
    res.json(todo);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  deleteTodo(req.params.id);
  res.status(204).end();
});

export default router;
