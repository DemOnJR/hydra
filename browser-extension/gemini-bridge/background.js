const LOCAL_SERVER = "http://127.0.0.1:3847";

async function sendBootstrapHeartbeat(agentId, secret, extra = {}) {
  if (!agentId) {
    return;
  }

  const headers = {
    "Content-Type": "application/json"
  };

  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  try {
    await fetch(`${LOCAL_SERVER}/api/browser-bridge/agents/${agentId}/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platform: "gemini",
        bridge: "extension-background",
        loggedIn: false,
        busy: false,
        ...extra
      })
    });
  } catch {
    // Ignore transient local bridge failures during browser startup.
  }
}

async function persistHydraConfigFromUrl(url) {
  if (!url || !url.startsWith("https://gemini.google.com/")) {
    return;
  }

  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "");
  const agentId = params.get("hydra-agent");
  const secret = params.get("hydra-secret");

  if (!agentId && !secret) {
    return;
  }

  const patch = {};

  if (agentId) {
    patch.hydraAgentId = agentId;
  }

  if (secret) {
    patch.hydraSecret = secret;
  }

  await chrome.storage.local.set(patch);
  await sendBootstrapHeartbeat(agentId, secret, {
    url,
    title: "Gemini bootstrap"
  });
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) {
    void persistHydraConfigFromUrl(changeInfo.url);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "hydra-fetch") {
    return false;
  }

  const headers = {
    "Content-Type": "application/json"
  };

  if (message.secret) {
    headers.Authorization = `Bearer ${message.secret}`;
  }

  fetch(`${LOCAL_SERVER}${message.path}`, {
    method: message.method || "GET",
    headers,
    body: message.body ? JSON.stringify(message.body) : undefined
  })
    .then(async (response) => {
      if (response.status === 204) {
        sendResponse({ ok: true, data: null });
        return;
      }

      const payload = await response.json();

      if (!response.ok) {
        sendResponse({
          ok: false,
          error: payload.error || `Request failed with status ${response.status}`
        });
        return;
      }

      sendResponse({
        ok: true,
        data: payload
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || "Hydra bridge request failed."
      });
    });

  return true;
});
