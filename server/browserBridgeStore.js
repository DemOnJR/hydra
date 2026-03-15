import { v4 as uuidv4 } from "uuid";

const agentStates = new Map();
const commands = new Map();
const queues = new Map();

function nowIso() {
  return new Date().toISOString();
}

function ensureQueue(agentId) {
  if (!queues.has(agentId)) {
    queues.set(agentId, []);
  }

  return queues.get(agentId);
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
  ensureQueue(agentId).push(id);
  return getCommandPublicShape(command);
}

export function getBridgeCommand(commandId) {
  return getCommandPublicShape(commands.get(commandId));
}

export function getNextBridgeCommand(agentId) {
  const queue = ensureQueue(agentId);

  while (queue.length > 0) {
    const commandId = queue[0];
    const command = commands.get(commandId);

    if (!command) {
      queue.shift();
      continue;
    }

    if (command.status === "pending") {
      command.status = "dispatched";
      command.updatedAt = nowIso();
      return getCommandPublicShape(command);
    }

    queue.shift();
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

  const queue = ensureQueue(command.agentId);
  if (queue[0] === commandId) {
    queue.shift();
  } else {
    const index = queue.indexOf(commandId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  return getCommandPublicShape(command);
}
