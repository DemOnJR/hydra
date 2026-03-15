import { Router } from "express";
import {
  completeBridgeCommand,
  enqueueBridgeCommand,
  getAgentBridgeState,
  getBridgeCommand,
  getNextBridgeCommand,
  isBridgeAgentConnected,
  upsertAgentBridgeState
} from "../browserBridgeStore.js";

const router = Router();

router.post("/agents/:agentId/heartbeat", (req, res) => {
  const state = upsertAgentBridgeState(req.params.agentId, req.body ?? {});
  res.json({
    ...state,
    connected: isBridgeAgentConnected(req.params.agentId)
  });
});

router.get("/agents/:agentId/state", (req, res) => {
  const state = getAgentBridgeState(req.params.agentId);

  res.json({
    connected: isBridgeAgentConnected(req.params.agentId),
    state
  });
});

router.get("/agents/:agentId/next", (req, res) => {
  const command = getNextBridgeCommand(req.params.agentId);
  res.json(command);
});

router.post("/commands", (req, res) => {
  const { agentId, type, payload = {} } = req.body ?? {};

  if (!agentId?.trim()) {
    res.status(400).json({ error: "agentId is required." });
    return;
  }

  if (!type?.trim()) {
    res.status(400).json({ error: "type is required." });
    return;
  }

  const command = enqueueBridgeCommand({
    agentId: agentId.trim(),
    type: type.trim(),
    payload
  });

  res.status(201).json(command);
});

router.get("/commands/:commandId", (req, res) => {
  const command = getBridgeCommand(req.params.commandId);

  if (!command) {
    res.status(404).json({ error: "Command not found." });
    return;
  }

  res.json(command);
});

router.post("/commands/:commandId/complete", (req, res) => {
  const { ok = false, response = "", error = "", meta = {} } = req.body ?? {};
  const command = completeBridgeCommand(req.params.commandId, {
    ok: Boolean(ok),
    response,
    error,
    meta
  });

  if (!command) {
    res.status(404).json({ error: "Command not found." });
    return;
  }

  res.json(command);
});

export default router;
