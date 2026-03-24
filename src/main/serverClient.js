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

export function prepareCoreToolCall(payload) {
  return request("/api/core/tool-calls/prepare", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function finalizeCoreToolCall(payload) {
  return request("/api/core/tool-calls/finalize", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchCoreToolExecution(requestId) {
  return request(`/api/core/tool-calls/${requestId}`);
}

export function transitionCoreTaskState(taskId, payload) {
  return request(`/api/core/tasks/${taskId}/transition`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function runCoreTaskVerification(taskId, payload) {
  return request(`/api/core/tasks/${taskId}/verification`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createCoreReviewIssue(taskId, payload) {
  return request(`/api/core/tasks/${taskId}/review-issues`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function markCoreTaskVerification(taskId, payload) {
  return request(`/api/core/tasks/${taskId}/verification-status`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchCoreTaskLifecycle(taskId) {
  return request(`/api/core/tasks/${taskId}/lifecycle`);
}

export function startCoreProcess(payload) {
  return request("/api/core/processes/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function stopCoreProcess(processId) {
  return request(`/api/core/processes/${processId}/stop`, {
    method: "POST"
  });
}

export function restartCoreProcess(processId) {
  return request(`/api/core/processes/${processId}/restart`, {
    method: "POST"
  });
}

export function listCoreProcesses(params = {}) {
  const query = new URLSearchParams();
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.taskId) query.set("taskId", params.taskId);
  if (params.state) query.set("state", params.state);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/core/processes${suffix}`);
}

export function readCoreProcessOutput(processId, params = {}) {
  const query = new URLSearchParams();
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.afterId != null) query.set("afterId", String(params.afterId));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/core/processes/${processId}/output${suffix}`);
}

export function captureCorePreview(payload) {
  return request("/api/core/preview/capture", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function detectCoreEnvironment(payload) {
  return request("/api/core/environment/detect", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function ensureCoreRuntime(payload) {
  return request("/api/core/environment/ensure-runtime", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createCoreEnvironment(payload) {
  return request("/api/core/environment/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function installCoreDependencies(payload) {
  return request("/api/core/environment/install", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function activateCoreEnvironment(payload) {
  return request("/api/core/environment/activate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function describeCoreEnvironment(params = {}) {
  const query = new URLSearchParams();
  if (params.profileId) query.set("profileId", params.profileId);
  if (params.projectId) query.set("projectId", params.projectId);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/core/environment/describe${suffix}`);
}

export function setCoreSecret(payload) {
  return request("/api/core/secrets/set", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listCoreSecretRefs(projectId) {
  return request(`/api/core/secrets?projectId=${encodeURIComponent(projectId)}`);
}

export function deleteCoreSecret(payload) {
  return request("/api/core/secrets", {
    method: "DELETE",
    body: JSON.stringify(payload)
  });
}

export function injectCoreSecret(payload) {
  return request("/api/core/secrets/inject", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listCoreTools(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.source) query.set("source", params.source);
  if (params.name) query.set("name", params.name);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/core/tools${suffix}`);
}

export function describeCoreTool(name, version = "") {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  return request(`/api/core/tools/${encodeURIComponent(name)}${suffix}`);
}

export function listCoreToolVersions(name) {
  return request(`/api/core/tools/${encodeURIComponent(name)}/versions`);
}

export function listCoreCapabilityGaps(params = {}) {
  const query = new URLSearchParams();
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.status) query.set("status", params.status);
  if (params.category) query.set("category", params.category);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/core/capability-gaps${suffix}`);
}

export function createCoreCapabilityGap(payload) {
  return request("/api/core/capability-gaps", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getCoreMetrics(projectId = null) {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request(`/api/core/observability/metrics${suffix}`);
}
