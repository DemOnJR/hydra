import { registerProvider } from "./registry.js";

const EDITOR_SELECTORS = [
  'rich-textarea div[contenteditable="true"]',
  'div[contenteditable="true"].ql-editor',
  'div.ql-editor[role="textbox"]',
  'div[role="textbox"][contenteditable="true"]',
  'div[role="textbox"]',
  "textarea"
];

const SEND_SELECTORS = [
  "button.send-button",
  'button[class*="send-button"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
  'button[aria-label="Trimite mesajul"]',
  'button[aria-label*="Trimite"]',
  'button[type="submit"]'
];

async function getEditor(page) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    for (const selector of EDITOR_SELECTORS) {
      const locator = page.locator(selector).first();

      try {
        await locator.waitFor({ state: "visible", timeout: 360000 });
        return locator;
      } catch {
        continue;
      }
    }

    const isClosed = page.isClosed();
    if (isClosed) break;
    await page.waitForTimeout(500).catch(() => {});
  }

  throw new Error("[Gemini] Prompt editor not found.");
}

export async function inject(page, prompt) {
  await page.waitForLoadState("domcontentloaded");
  const editor = await getEditor(page);
  await editor.click();
  await editor.fill(prompt);
  await page.waitForTimeout(300).catch(() => {});

  for (const selector of SEND_SELECTORS) {
    const button = page.locator(selector).first();

    if ((await button.count()) > 0 && (await button.isVisible()) && (await button.isEnabled())) {
      await button.click();
      return true;
    }
  }

  await editor.press("Enter");
  return true;
}

const STOP_SELECTORS = [
  '[aria-label="Gemini is thinking"]',
  ".loading-indicator",
  'button[aria-label="Stop response"]'
];

const RESPONSE_SELECTORS = ["model-response", ".response-content", "message-content"];

export async function waitForResponse(page, timeoutMs = 120000) {
  // Phase 1: Wait for a stop/loading indicator to appear (generation started) — 15s window
  const startDeadline = Date.now() + 15000;
  let stopSelector = null;

  outer: while (Date.now() < startDeadline) {
    for (const selector of STOP_SELECTORS) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) { stopSelector = selector; break outer; }
    }
    const isClosed = page.isClosed();
    if (isClosed) throw new Error("BROWSER_CLOSED: The agent browser was closed during the task.");
    await page.waitForTimeout(250).catch(() => {});
  }

  // Phase 2: Poll until all stop indicators are gone and response is stable — no deadline
  let latestText = "";
  let lastChangedAt = Date.now();

  while (true) {
    const isClosed = page.isClosed();
    if (isClosed) throw new Error("BROWSER_CLOSED: The agent browser was closed during the task.");

    // Read latest response text
    let currentText = "";
    for (const selector of RESPONSE_SELECTORS) {
      const locator = page.locator(selector).last();
      if ((await locator.count().catch(() => 0)) > 0) {
        currentText = String(await locator.innerText().catch(() => "")).trim();
        if (currentText) break;
      }
    }

    if (currentText && currentText !== latestText) {
      latestText = currentText;
      lastChangedAt = Date.now();
    }

    // Check if any loading/stop indicator is still visible
    let stillLoading = false;
    for (const selector of STOP_SELECTORS) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        stillLoading = true;
        break;
      }
    }

    const stableMs = Date.now() - lastChangedAt;

    // Return when not loading and text stable for 1.5s
    if (!stillLoading && latestText && stableMs >= 1500) {
      return latestText;
    }

    await page.waitForTimeout(300).catch(() => {});
  }
}

export async function isLoggedIn(page) {
  const url = page.url();
  return Boolean(url) && !url.includes("/signin") && !url.includes("/auth");
}

registerProvider("gemini", {
  inject,
  waitForResponse,
  isLoggedIn
});
