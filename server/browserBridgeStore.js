import { v4 as uuidv4 } from "uuid";

const agentStates = new Map();
const commands = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getCommandPublicShape(command) {
  if (!command) {
    return null;
  }

  return {
    id: command.id,
    agentId: command.agentId,
    type: command.type,
    status: command.status,
    payload: command.payload,
    result: command.result,
    error: command.error,
    meta: command.meta,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt
  };
}

export function upsertAgentBridgeState(agentId, patch = {}) {
  const current = agentStates.get(agentId) || {
    agentId,
    platform: patch.platform || "",
    url: patch.url || "",
    loggedIn: false,
    busy: false,
    connectedAt: nowIso(),
    lastSeenAt: nowIso(),
    bridge: "extension"
  };

  const next = {
    ...current,
    ...patch,
    agentId,
    connectedAt: current.connectedAt || nowIso(),
    lastSeenAt: nowIso(),
    bridge: "extension"
  };

  agentStates.set(agentId, next);
  return next;
}

export function getAgentBridgeState(agentId) {
  return agentStates.get(agentId) || null;
}

export function isBridgeAgentConnected(agentId, maxAgeMs = 15000) {
  const state = getAgentBridgeState(agentId);

  if (!state?.lastSeenAt) {
    return false;
  }

  return Date.now() - new Date(state.lastSeenAt).getTime() <= maxAgeMs;
}

export function enqueueBridgeCommand({ agentId, type, payload = {} }) {
  const id = uuidv4();
  const command = {
    id,
    agentId,
    type,
    payload,
    status: "pending",
    result: null,
    error: "",
    meta: {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  commands.set(id, command);
  return getCommandPublicShape(command);
}

export function getBridgeCommand(commandId) {
  return getCommandPublicShape(commands.get(commandId));
}

export function getNextBridgeCommand(agentId) {
  // Find the oldest pending command for this agent
  const pending = [...commands.values()]
    .filter(c => c.agentId === agentId && c.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (pending.length > 0) {
    const command = pending[0];
    command.status = "dispatched";
    command.updatedAt = nowIso();
    return getCommandPublicShape(command);
  }

  return null;
}

export function completeBridgeCommand(commandId, { ok, response = "", error = "", meta = {} }) {
  const command = commands.get(commandId);

  if (!command) {
    return null;
  }

  command.status = ok ? "complete" : "error";
  command.result = ok ? { response } : null;
  command.error = ok ? "" : String(error || "Bridge command failed.");
  command.meta = meta;
  command.updatedAt = nowIso();

  return getCommandPublicShape(command);
}
