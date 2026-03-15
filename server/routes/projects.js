import { Router } from "express";
import {
  createProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  setActiveProject,
  updateProject
} from "../db/queries.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getAllProjects());
});

router.post("/", (req, res) => {
  const { name, description = "", rootPath = "", mode = "manual" } = req.body ?? {};

  if (!name?.trim()) {
    res.status(400).json({ error: "Project name is required." });
    return;
  }

  const project = createProject({
    name: name.trim(),
    description: description.trim(),
    rootPath: rootPath.trim(),
    mode
  });

  res.status(201).json(project);
});

router.get("/:id", (req, res) => {
  const project = getProjectById(req.params.id);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  res.json(project);
});

router.patch("/:id", (req, res) => {
  if (req.body?.name !== undefined && !String(req.body.name).trim()) {
    res.status(400).json({ error: "Project name cannot be empty." });
    return;
  }

  const project = updateProject(req.params.id, req.body ?? {});

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  res.json(project);
});

router.put("/:id/activate", (req, res) => {
  const project = setActiveProject(req.params.id);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  res.json(project);
});

router.delete("/:id", (req, res) => {
  deleteProject(req.params.id);
  res.status(204).end();
});

export default router;
