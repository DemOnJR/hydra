import { Router } from "express";
import { listNotifications, markNotificationRead } from "../db/queries.js";

const router = Router();

router.get("/", (req, res) => {
  const projectId = req.query.projectId?.toString() || "";
  const limit = Number.parseInt(req.query.limit?.toString() || "50", 10);

  if (!projectId.trim()) {
    res.status(400).json({ error: "projectId is required." });
    return;
  }

  res.json(listNotifications(projectId, Number.isNaN(limit) ? 50 : limit));
});

router.patch("/:id/read", (req, res) => {
  res.json(markNotificationRead(req.params.id));
});

export default router;
