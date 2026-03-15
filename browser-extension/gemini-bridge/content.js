(function bootstrapHydraGeminiBridge() {
  const POLL_INTERVAL_MS = 1500;
  const HEARTBEAT_INTERVAL_MS = 5000;
  let busy = false;
  let lastHeartbeatAt = 0;

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function visible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function findVisibleElement(selectors) {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      const candidate = matches.find((element) => visible(element));

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function parseHydraConfigFromHash() {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";

    if (!hash) {
      return {};
    }

    const params = new URLSearchParams(hash);
    const agentId = params.get("hydra-agent") || "";
    const secret = params.get("hydra-secret") || "";

    if (agentId || secret) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    return {
      agentId,
      secret
    };
  }

  async function ensureHydraConfig() {
    const hashConfig = parseHydraConfigFromHash();

    if (hashConfig.agentId || hashConfig.secret) {
      const patch = {};

      if (hashConfig.agentId) {
        patch.hydraAgentId = hashConfig.agentId;
      }

      if (hashConfig.secret) {
        patch.hydraSecret = hashConfig.secret;
      }

      await chrome.storage.local.set(patch);
    }

    const stored = await chrome.storage.local.get(["hydraAgentId", "hydraSecret"]);
    return {
      agentId: stored.hydraAgentId || "",
      secret: stored.hydraSecret || ""
    };
  }

  function runtimeFetch(method, path, body, secret) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "hydra-fetch",
          method,
          path,
          body,
          secret
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "Hydra bridge request failed."));
            return;
          }

          resolve(response.data);
        }
      );
    });
  }

  function isLoggedIn() {
    return !window.location.href.includes("/signin") && !window.location.href.includes("/auth");
  }

  function getPromptEditor() {
    return findVisibleElement([
      "rich-textarea div[contenteditable='true']",
      "div[contenteditable='true'].ql-editor",
      "div[role='textbox']",
      "textarea"
    ]);
  }

  function getSendButton() {
    return findVisibleElement([
      "button[aria-label='Send message']",
      "button[aria-label='Send']",
      "button[mattooltip='Send message']"
    ]);
  }

  function getResponseSnapshot() {
    const selectors = ["model-response", ".response-content", "message-content"];

    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter((element) =>
        visible(element)
      );

      if (matches.length > 0) {
        const last = matches[matches.length - 1];
        return {
          count: matches.length,
          text: (last.innerText || "").trim()
        };
      }
    }

    return {
      count: 0,
      text: ""
    };
  }

  function isGeminiThinking() {
    return Boolean(
      findVisibleElement([
        "[aria-label='Gemini is thinking']",
        ".loading-indicator",
        "button[aria-label='Stop response']"
      ])
    );
  }

  function setPromptText(editor, prompt) {
    editor.focus();

    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(editor),
        "value"
      );

      if (descriptor?.set) {
        descriptor.set.call(editor, prompt);
      } else {
        editor.value = prompt;
      }

      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, prompt);

    if ((editor.innerText || "").trim() !== prompt.trim()) {
      editor.textContent = prompt;
      editor.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: prompt
        })
      );
    }
  }

  async function waitForGeminiResponse(previousSnapshot, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = 0;

    while (Date.now() < deadline) {
      const snapshot = getResponseSnapshot();
      const changed =
        snapshot.count > previousSnapshot.count || snapshot.text !== previousSnapshot.text;
      const thinking = isGeminiThinking();

      if (changed && snapshot.text && !thinking) {
        if (!stableSince) {
          stableSince = Date.now();
        }

        if (Date.now() - stableSince >= 1500) {
          return snapshot.text;
        }
      } else {
        stableSince = 0;
      }

      await sleep(500);
    }

    throw new Error("Timed out waiting for Gemini response.");
  }

  async function runPrompt(prompt, timeoutMs) {
    const editor = getPromptEditor();

    if (!editor) {
      throw new Error("Gemini prompt editor not found.");
    }

    const previousSnapshot = getResponseSnapshot();
    setPromptText(editor, prompt);
    await sleep(250);

    const sendButton = getSendButton();

    if (sendButton) {
      sendButton.click();
    } else {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          which: 13,
          keyCode: 13,
          bubbles: true
        })
      );
    }

    return waitForGeminiResponse(previousSnapshot, timeoutMs);
  }

  async function sendHeartbeat(config) {
    if (!config.agentId) {
      return;
    }

    await runtimeFetch(
      "POST",
      `/api/browser-bridge/agents/${config.agentId}/heartbeat`,
      {
        platform: "gemini",
        url: window.location.href,
        loggedIn: isLoggedIn(),
        busy,
        title: document.title
      },
      config.secret
    );
  }

  async function maybeHeartbeat(config) {
    if (Date.now() - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
      return;
    }

    lastHeartbeatAt = Date.now();
    await sendHeartbeat(config);
  }

  async function processNextCommand(config) {
    if (!config.agentId || busy || !isLoggedIn()) {
      return;
    }

    const command = await runtimeFetch(
      "GET",
      `/api/browser-bridge/agents/${config.agentId}/next`,
      null,
      config.secret
    );

    if (!command) {
      return;
    }

    busy = true;
    await sendHeartbeat(config);

    try {
      if (command.type !== "send_prompt") {
        throw new Error(`Unsupported Gemini bridge command "${command.type}".`);
      }

      const responseText = await runPrompt(
        command.payload?.prompt || "",
        Number(command.payload?.timeoutMs || 240000)
      );

      await runtimeFetch(
        "POST",
        `/api/browser-bridge/commands/${command.id}/complete`,
        {
          ok: true,
          response: responseText,
          meta: {
            url: window.location.href
          }
        },
        config.secret
      );
    } catch (error) {
      await runtimeFetch(
        "POST",
        `/api/browser-bridge/commands/${command.id}/complete`,
        {
          ok: false,
          error: error.message || "Gemini bridge command failed.",
          meta: {
            url: window.location.href
          }
        },
        config.secret
      );
    } finally {
      busy = false;
      await sendHeartbeat(config);
    }
  }

  async function mainLoop() {
    const config = await ensureHydraConfig();

    if (!config.agentId) {
      return;
    }

    while (true) {
      try {
        await maybeHeartbeat(config);
        await processNextCommand(config);
      } catch {
        // Keep polling; local bridge might be temporarily unavailable.
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  void mainLoop();
})();
