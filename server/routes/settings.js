import { Router } from "express";
import { getAppSettings, updateAppSettings } from "../db/queries.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getAppSettings());
});

router.put("/", (req, res) => {
  res.json(updateAppSettings(req.body ?? {}));
});

export default router;
