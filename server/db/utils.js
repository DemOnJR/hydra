export const PROJECT_MODES = ["manual", "semi-auto", "full-auto"];
export const TODO_STATUSES = ["pending", "in_progress", "complete"];
export const TODO_PRIORITIES = ["low", "medium", "high", "critical"];
export const SESSION_STATUSES = ["running", "waiting_approval", "complete", "error", "stopped"];
export const SESSION_DECISIONS = ["pending", "approved", "rejected"];
export const AGENT_ROLES = ["orchestrator", "worker"];
export const APPROVAL_MODES = ["manual", "auto"];

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function snippet(value, maxLength = 220) {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized;
}

export function isoOrEmpty(value) {
  return value ? String(value) : "";
}

export function normalizeProjectMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  return PROJECT_MODES.includes(normalized) ? normalized : "manual";
}

export function normalizeTodoPriority(priority) {
  const normalized = typeof priority === "string" ? priority.trim() : "";
  return TODO_PRIORITIES.includes(normalized) ? normalized : "medium";
}

export function normalizeTodoStatus(status) {
  const normalized = typeof status === "string" ? status.trim() : "";
  if (!TODO_STATUSES.includes(normalized)) throw new Error(`Invalid todo status "${status}".`);
  return normalized;
}

export function normalizeSessionStatus(status) {
  const normalized = typeof status === "string" ? status.trim() : "";
  if (!SESSION_STATUSES.includes(normalized)) throw new Error(`Invalid session status "${status}".`);
  return normalized;
}

export function normalizeSessionDecision(decision) {
  const normalized = typeof decision === "string" ? decision.trim() : "";
  if (!SESSION_DECISIONS.includes(normalized)) throw new Error(`Invalid session decision "${decision}".`);
  return normalized;
}

export function normalizeAgentRole(role) {
  const normalized = typeof role === "string" ? role.trim() : "";
  return AGENT_ROLES.includes(normalized) ? normalized : "worker";
}

export function normalizeApprovalMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  return APPROVAL_MODES.includes(normalized) ? normalized : "manual";
}

export function getConversationChannelForRole(role) {
  return role === "orchestrator" ? "orchestrator" : "worker";
}
