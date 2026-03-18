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

export function fetchAgent(agentId) {
  return request(`/api/agents/${agentId}`);
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

export function completeTask(taskId, response, aiMeta = null) {
  return request(`/api/tasks/${taskId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ response, aiMeta })
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

export function callAiOnServer(payload, onMessage = null) {
  if (payload.stream && typeof onMessage === "function") {
    // Return a promise that resolves when the stream ends
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(`${getServerBaseUrl()}/api/ai/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(LOCAL_SECRET ? { Authorization: `Bearer ${LOCAL_SECRET}` } : {})
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const err = await response.json();
          reject(new Error(err.error || "Stream request failed"));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const msg = JSON.parse(line.slice(6));
                if (msg.type === "done") {
                  resolve(msg.result);
                } else if (msg.type === "error") {
                  reject(new Error(msg.error));
                } else {
                  onMessage(msg);
                }
              } catch (e) {
                // Ignore parse errors for partial lines
              }
            }
          }
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  return request("/api/ai/call", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
