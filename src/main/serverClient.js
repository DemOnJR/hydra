const HOST = process.env.CONTEXT_SERVER_HOST || "127.0.0.1";
const PORT = process.env.CONTEXT_SERVER_PORT || "3847";
const LOCAL_SECRET = process.env.LOCAL_SECRET?.trim();

export function getServerBaseUrl() {
  return `http://${HOST}:${PORT}`;
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (LOCAL_SECRET) {
    headers.Authorization = `Bearer ${LOCAL_SECRET}`;
  }

  const response = await fetch(`${getServerBaseUrl()}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

export function fetchContext(projectId) {
  return request(`/api/context/${projectId}`);
}

export function fetchAgents() {
  return request("/api/agents");
}

export function getBrowserBridgeState(agentId) {
  return request(`/api/browser-bridge/agents/${agentId}/state`);
}

export function enqueueBrowserBridgeCommand(agentId, type, payload = {}) {
  return request("/api/browser-bridge/commands", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      type,
      payload
    })
  });
}

export function getBrowserBridgeCommand(commandId) {
  return request(`/api/browser-bridge/commands/${commandId}`);
}

export function saveDecisions(projectId, decisions) {
  return request(`/api/context/${projectId}/decisions/bulk`, {
    method: "POST",
    body: JSON.stringify({ decisions })
  });
}

export function createTask(task) {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task)
  });
}

export function updateTaskStatus(taskId, status) {
  return request(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function completeTask(taskId, response) {
  return request(`/api/tasks/${taskId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ response })
  });
}

export function updateAgentStatus(agentId, status) {
  return request(`/api/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function getAppSettings() {
  return request("/api/settings");
}
