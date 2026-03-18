import { registerProvider } from "./registry.js";

const STOP_SELECTOR = 'button[aria-label*="Stop"]';
const RESPONSE_CONTAINER_SELECTOR = "[data-is-streaming]";
const SETTLED_RESPONSE_SELECTORS = [
  '[data-is-streaming="false"] .font-claude-response .standard-markdown',
  '[data-is-streaming="false"] .font-claude-response',
  '[data-is-streaming="false"] [class*="font-claude-response"]',
  'main [data-is-streaming="false"]'
];

const STREAMING_RESPONSE_SELECTORS = [
  '[data-is-streaming="true"] .font-claude-response .standard-markdown',
  '[data-is-streaming="true"] .font-claude-response',
  '[data-is-streaming="true"] [class*="font-claude-response"]',
  'main [data-is-streaming="true"]',
  ".font-claude-response .standard-markdown",
  ".font-claude-response"
];

async function getEditor(page) {
  const selectors = [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][data-placeholder]',
    'div[role="textbox"]',
    "textarea"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return locator;
    } catch {
      continue;
    }
  }

  throw new Error("[Claude] Prompt editor not found.");
}

async function getEditorText(editor) {
  return editor.evaluate((node) => {
    if ("value" in node) {
      return String(node.value ?? "").replace(/\u200b/g, "").trim();
    }

    return String(node.textContent ?? "").replace(/\u200b/g, "").trim();
  });
}

async function clearEditor(page, editor) {
  await editor.click();

  try {
    await editor.fill("", { timeout: 2000 });
    return;
  } catch {
    // Some ProseMirror/Tiptap editors intermittently fail Playwright's editable check for fill().
    // Fall back to keyboard-based clearing.
  }

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
}

async function setEditorText(page, editor, text) {
  const next = String(text ?? "");
  await editor.click();

  try {
    await editor.fill(next, { timeout: 360000 });
    return;
  } catch {
    // Fall back to keyboard insertion.
  }

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(next);
}

async function captureResponseState(page, options = {}) {
  const responseContainers = page.locator(
    options.includeStreaming ? RESPONSE_CONTAINER_SELECTOR : '[data-is-streaming="false"]'
  );
  const count = await responseContainers.count().catch(() => 0);
  let latestText = "";
  let lastNonEmptyText = "";

  for (let index = count - 1; index >= 0; index -= 1) {
    const text = String(await extractLocatorText(responseContainers.nth(index)).catch(() => "")).trim();

    if (index === count - 1) {
      latestText = text;
    }

    if (!lastNonEmptyText && text) {
      lastNonEmptyText = text;
    }

    if (latestText && lastNonEmptyText) {
      break;
    }
  }

  if (!lastNonEmptyText) {
    lastNonEmptyText = String(await tryReadLatestResponse(page, options).catch(() => "")).trim();
  }

  return {
    count,
    latestText,
    lastNonEmptyText
  };
}

function hasResponseAdvanced(current, baseline = {}) {
  const baselineCount = baseline.count ?? 0;
  const baselineLatestText = String(baseline.latestText ?? "").trim();
  const baselineLastNonEmptyText = String(baseline.lastNonEmptyText ?? "").trim();
  const currentLatestText = String(current?.latestText ?? "").trim();
  const currentLastNonEmptyText = String(current?.lastNonEmptyText ?? "").trim();

  return (
    (current?.count > baselineCount && Boolean(currentLatestText)) ||
    (currentLatestText && currentLatestText !== baselineLatestText) ||
    (currentLastNonEmptyText && currentLastNonEmptyText !== baselineLastNonEmptyText)
  );
}

async function confirmSendStarted(page, baselineResponseState, timeoutMs = 12000) {
  const stopButton = page.locator(STOP_SELECTOR).first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const stopVisible = await stopButton.isVisible().catch(() => false);

    if (stopVisible) {
      return true;
    }

    const responseState = await captureResponseState(page, { includeStreaming: true });
    if (hasResponseAdvanced(responseState, baselineResponseState)) {
      return true;
    }

    const isClosed = page.isClosed();
    if (isClosed) break;
    await page.waitForTimeout(250).catch(() => {});
  }

  return false;
}

function extractBalancedJsonValue(text, searchOffset = 0) {
  const source = String(text ?? "");
  if (searchOffset >= source.length) {
    return null;
  }

  const objectIndex = source.indexOf("{", searchOffset);
  const arrayIndex = source.indexOf("[", searchOffset);
  let startIndex = -1;

  if (objectIndex === -1) {
    startIndex = arrayIndex;
  } else if (arrayIndex === -1) {
    startIndex = objectIndex;
  } else {
    startIndex = Math.min(objectIndex, arrayIndex);
  }

  if (startIndex === -1) {
    return null;
  }

  const opening = source[startIndex];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;

      if (depth === 0) {
        return {
          value: source.slice(startIndex, index + 1),
          startIndex,
          endIndex: index + 1
        };
      }
    }
  }

  return {
    value: null,
    startIndex,
    endIndex: startIndex + 1
  };
}

function parseHydraJson(candidateText) {
  const text = String(candidateText ?? "").trim();
  let currentOffset = 0;

  while (currentOffset < text.length) {
    const result = extractBalancedJsonValue(text, currentOffset);
    if (!result) {
      break;
    }

    if (result.value) {
      try {
        const parsed = JSON.parse(result.value);
        const request = Array.isArray(parsed) ? parsed[0] : parsed;

        if (request && typeof request === "object" && String(request.action ?? "").trim()) {
          return request;
        }
      } catch {
        // Not valid JSON
      }
    }

    currentOffset = result.startIndex + 1;
  }

  return null;
}

function hasHydraLikeContent(text) {
  const normalized = String(text ?? "").trim();

  return (
    /```hydra/i.test(normalized) ||
    /(?:^|\n)\s*hydra(?:-tool)?(?:\s+|[\[{])/i.test(normalized) ||
    /"action"\s*:\s*"/i.test(normalized)
  );
}

function hasCompleteHydraRequest(text) {
  const normalized = String(text ?? "").trim();

  if (!normalized) {
    return false;
  }

  const fencedMatch = normalized.match(/```hydra(?:-tool)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1] && parseHydraJson(fencedMatch[1])) {
    return true;
  }

  const inlineMatch = normalized.match(/(?:^|\n)\s*hydra(?:-tool)?\s*(\{[\s\S]*)$/i);
  if (inlineMatch?.[1] && parseHydraJson(inlineMatch[1])) {
    return true;
  }

  const inlineArrayMatch = normalized.match(/(?:^|\n)\s*hydra(?:-tool)?\s*(\[[\s\S]*)$/i);
  if (inlineArrayMatch?.[1] && parseHydraJson(inlineArrayMatch[1])) {
    return true;
  }

  return Boolean(parseHydraJson(normalized));
}

function ensureResponseIsComplete(text) {
  const normalized = String(text ?? "").trim();

  if (!normalized) {
    return normalized;
  }

  if (hasHydraLikeContent(normalized) && !hasCompleteHydraRequest(normalized)) {
    throw new Error("[Claude] Response ended with an incomplete Hydra request.");
  }

  return normalized;
}

export async function inject(page, prompt) {
  await page.waitForLoadState("domcontentloaded");
  const editor = await getEditor(page);
  const baselineResponseState = await captureResponseState(page, { includeStreaming: true });
  await editor.click();
  await clearEditor(page, editor);
  await setEditorText(page, editor, prompt);
  await page.waitForTimeout(250).catch(() => {});

  const sendSelectors = [
    'button[aria-label="Send Message"]',
    'button[type="submit"]'
  ];

  for (const selector of sendSelectors) {
    const button = page.locator(selector).first();

    if ((await button.count()) > 0 && (await button.isVisible()) && (await button.isEnabled())) {
      await button.click();

      if (await confirmSendStarted(page, baselineResponseState)) {
        return { baselineResponseState };
      }

      break;
    }
  }

  await editor.press("Enter");

  if (await confirmSendStarted(page, baselineResponseState)) {
    return { baselineResponseState };
  }

  await clearEditor(page, editor);
  throw new Error("[Claude] Message did not send. The draft was left in the composer.");
}

export async function waitForResponse(page, timeoutMs = 120000, options = {}) {
  const baselineResponseState = options.baselineResponseState ?? null;

  if (baselineResponseState) {
    return ensureResponseIsComplete(
      await readNextResponse(page, baselineResponseState, { includeStreaming: true })
    );
  }

  return ensureResponseIsComplete(await readLastResponse(page, 5000, { includeStreaming: true }));
}

async function checkForUsageLimit(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const limitPatterns = [
      "free message limit",
      "hit your limit for Claude messages",
      "out of free messages"
    ];

    for (const pattern of limitPatterns) {
      if (text.includes(pattern)) {
        const resetMatch = text.match(/(?:reset|until)\s+(?:at\s+)?(\d{1,2}:\d{2}\s*[AP]M)/i);
        let errorMsg = `USAGE_LIMIT_REACHED: Claude limit hit.`;
        if (resetMatch) {
          errorMsg += ` Reset at ${resetMatch[1]}.`;
        }
        return errorMsg;
      }
    }
    return null;
  });
}

async function readNextResponse(page, baselineResponseState, options = {}) {
  const stopButton = page.locator(STOP_SELECTOR).first();

  // Phase 1: Wait for stop button to appear (generation started)
  // Use a reasonable startup window — if it never appears, fall through
  const startDeadline = Date.now() + 15000;
  while (Date.now() < startDeadline) {
    const usageLimit = await checkForUsageLimit(page);
    if (usageLimit) throw new Error(usageLimit);

    const stopVisible = await stopButton.isVisible().catch(() => false);
    if (stopVisible) break;
    const responseState = await captureResponseState(page, options);
    if (hasResponseAdvanced(responseState, baselineResponseState)) break;
    const isClosed = page.isClosed();
    if (isClosed) throw new Error("BROWSER_CLOSED: The agent browser was closed during the task.");
    await page.waitForTimeout(250).catch(() => {});
  }

  // Phase 2: Poll until stop button disappears (generation finished)
  // No deadline — just wait for the AI to finish, however long it takes
  let latestText = "";
  let lastChangedAt = Date.now();

  while (true) {
    const usageLimit = await checkForUsageLimit(page);
    if (usageLimit) throw new Error(usageLimit);

    const isClosed = page.isClosed();
    if (isClosed) throw new Error("BROWSER_CLOSED: The agent browser was closed during the task.");

    const responseState = await captureResponseState(page, options);
    const currentText = String(
      responseState.latestText || responseState.lastNonEmptyText || ""
    ).trim();

    if (currentText && currentText !== latestText) {
      latestText = currentText;
      lastChangedAt = Date.now();
    }

    const stopVisible = await stopButton.isVisible().catch(() => false);
    const stableMs = Date.now() - lastChangedAt;

    // Return early if we have a complete Hydra request and it's been stable 2s
    if (latestText && stopVisible && hasCompleteHydraRequest(latestText) && stableMs >= 2000) {
      return latestText;
    }

    // Return when stop button gone and text has been stable for 1s
    if (!stopVisible && latestText && stableMs >= 1000) {
      return latestText;
    }

    await page.waitForTimeout(300).catch(() => {});
  }
}

async function extractLocatorText(locator) {
  return locator.evaluate((node) => {
    const clone = node.cloneNode(true);

    clone
      .querySelectorAll(
        'button, [role="group"][aria-label="Message actions"], [data-testid="action-bar-copy"], [data-testid="action-bar-retry"], time'
      )
      .forEach((element) => element.remove());

    const responseRoot =
      clone.querySelector(".font-claude-response .standard-markdown") ||
      clone.querySelector(".font-claude-response") ||
      clone;

    return responseRoot.textContent?.trim() || "";
  });
}

async function tryReadLatestResponse(page, options = {}) {
  const responseContainers = page.locator(
    options.includeStreaming ? RESPONSE_CONTAINER_SELECTOR : '[data-is-streaming="false"]'
  );
  const responseContainerCount = await responseContainers.count().catch(() => 0);

  for (let index = responseContainerCount - 1; index >= 0; index -= 1) {
    const text = await extractLocatorText(responseContainers.nth(index)).catch(() => "");

    if (text) {
      return text;
    }
  }

  const selectors = options.includeStreaming
    ? [...SETTLED_RESPONSE_SELECTORS, ...STREAMING_RESPONSE_SELECTORS]
    : SETTLED_RESPONSE_SELECTORS;

  const fallbackSelectors = options.includeStreaming
    ? ['[data-is-streaming="false"]', '[data-is-streaming="true"]', '[data-is-streaming]']
    : ['[data-is-streaming="false"]'];

  for (const selector of [...selectors, ...fallbackSelectors]) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);

    for (let index = count - 1; index >= 0; index -= 1) {
      const text = await extractLocatorText(matches.nth(index)).catch(() => "");

      if (text) {
        return text;
      }
    }
  }

  return "";
}

async function readLastResponse(page, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const usageLimit = await checkForUsageLimit(page);
    if (usageLimit) throw new Error(usageLimit);

    const text = await tryReadLatestResponse(page, options);

    if (text) {
      return text;
    }

    const isClosed = page.isClosed();
    if (isClosed) break;
    await page.waitForTimeout(500).catch(() => {});
  }

  throw new Error("[Claude] Response not found.");
}

export async function isLoggedIn(page) {
  const url = page.url();
  return Boolean(url) && !url.includes("/login") && !url.includes("/signup");
}

registerProvider("claude", {
  inject,
  waitForResponse,
  isLoggedIn
});
