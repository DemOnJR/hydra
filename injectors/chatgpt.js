import { registerProvider } from "./registry.js";

const STOP_SELECTOR = '[data-testid="stop-button"]';
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';

async function getEditor(page) {
  const selectors = [
    "#prompt-textarea",
    'textarea[placeholder]',
    'div[contenteditable="true"]'
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

  throw new Error("[ChatGPT] Prompt editor not found.");
}

async function getEditorText(editor) {
  return editor.evaluate((node) => {
    if ("value" in node) {
      return String(node.value ?? "").replace(/\u200b/g, "").trim();
    }

    return String(node.textContent ?? "").replace(/\u200b/g, "").trim();
  });
}

async function clearEditor(editor) {
  await editor.click();
  await editor.fill("");
}

async function captureResponseState(page) {
  const count = await page.locator(ASSISTANT_SELECTOR).count().catch(() => 0);
  const lastText =
    count > 0
      ? await page.locator(ASSISTANT_SELECTOR).last().innerText().catch(() => "")
      : "";

  return {
    count,
    lastText: String(lastText ?? "").trim()
  };
}

function hasResponseAdvanced(current, baseline = {}) {
  const baselineCount = baseline.count ?? 0;
  const baselineText = String(baseline.lastText ?? "").trim();
  const currentText = String(current?.lastText ?? "").trim();

  return current?.count > baselineCount || (currentText && currentText !== baselineText);
}

async function confirmSendStarted(page, baselineResponseState, timeoutMs = 10000) {
  const stopButton = page.locator(STOP_SELECTOR).first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const stopVisible = await stopButton.isVisible().catch(() => false);

    if (stopVisible) {
      return true;
    }

    const responseState = await captureResponseState(page);
    if (hasResponseAdvanced(responseState, baselineResponseState)) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

export async function inject(page, prompt) {
  await page.waitForLoadState("domcontentloaded");
  const editor = await getEditor(page);
  const baselineResponseState = await captureResponseState(page);
  await editor.click();
  await clearEditor(editor);
  await editor.fill(prompt);
  await page.waitForTimeout(250);

  const sendSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]'
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

  await clearEditor(editor);
  throw new Error("[ChatGPT] Message did not send. The draft was left in the composer.");
}

export async function waitForResponse(page, timeoutMs = 120000, options = {}) {
  const baselineResponseState = options.baselineResponseState ?? null;

  try {
    await page.waitForSelector(STOP_SELECTOR, {
      timeout: 10000
    });
  } catch {
    if (baselineResponseState) {
      return readNextResponse(page, timeoutMs, baselineResponseState);
    }

    return readLastResponse(page, timeoutMs);
  }

  await page.waitForSelector(STOP_SELECTOR, {
    state: "detached",
    timeout: timeoutMs
  });

  return readLastResponse(page, timeoutMs);
}

async function readLastResponse(page, timeoutMs) {
  const response = page.locator('[data-message-author-role="assistant"]').last();
  await response.waitFor({ state: "visible", timeout: timeoutMs });
  return response.innerText();
}

async function readNextResponse(page, timeoutMs, baselineResponseState) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const responseState = await captureResponseState(page);

    if (hasResponseAdvanced(responseState, baselineResponseState)) {
      return responseState.lastText;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("[ChatGPT] No new response detected after sending the message.");
}

export async function isLoggedIn(page) {
  const url = page.url();
  return Boolean(url) && !url.includes("/auth") && !url.includes("/login");
}

registerProvider("chatgpt", {
  inject,
  waitForResponse,
  isLoggedIn
});
