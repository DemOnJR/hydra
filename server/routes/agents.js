import { Router } from "express";
import {
  createAgent,
  deleteAgent,
  getAllAgents,
  updateAgentName,
  updateAgentRole,
  updateAgentSpecialty,
  updateAgentStatus
} from "../db/queries.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getAllAgents());
});

router.post("/", (req, res) => {
  const { name, platform, role = "worker", specialty = "" } = req.body ?? {};

  if (!name?.trim()) {
    res.status(400).json({ error: "Agent name is required." });
    return;
  }

  if (!platform?.trim()) {
    res.status(400).json({ error: "Agent platform is required." });
    return;
  }

  const agent = createAgent({
    name: name.trim(),
    platform: platform.trim(),
    role,
    specialty
  });

  res.status(201).json(agent);
});

router.patch("/:id", (req, res) => {
  const { status, role, specialty, name } = req.body ?? {};

  if (!status && !role && specialty === undefined && !name) {
    res.status(400).json({ error: "Agent status, role, specialty, or name is required." });
    return;
  }

  let agent = null;

  if (name) {
    agent = updateAgentName(req.params.id, name);
  }

  if (status) {
    agent = updateAgentStatus(req.params.id, status);
  }

  if (role) {
    agent = updateAgentRole(req.params.id, role);
  }

  if (specialty !== undefined) {
    agent = updateAgentSpecialty(req.params.id, specialty);
  }

  res.json(agent);
});

router.delete("/:id", (req, res) => {
  deleteAgent(req.params.id);
  res.status(204).end();
});

export default router;
