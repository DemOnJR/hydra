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
        await locator.waitFor({ state: "visible", timeout: 1500 });
        return locator;
      } catch {
        continue;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error("[Gemini] Prompt editor not found.");
}

export async function inject(page, prompt) {
  await page.waitForLoadState("domcontentloaded");
  const editor = await getEditor(page);
  await editor.click();
  await editor.fill(prompt);
  await page.waitForTimeout(300);

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

export async function waitForResponse(page, timeoutMs = 120000) {
  const loadingSelectors = [
    '[aria-label="Gemini is thinking"]',
    ".loading-indicator",
    'button[aria-label="Stop response"]'
  ];

  for (const selector of loadingSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 8000 });
      await page.waitForSelector(selector, {
        state: "detached",
        timeout: timeoutMs
      });
      return readLastResponse(page, timeoutMs);
    } catch {
      continue;
    }
  }

  return readLastResponse(page, timeoutMs);
}

async function readLastResponse(page, timeoutMs) {
  const selectors = ["model-response", ".response-content", "message-content"];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();

    if ((await locator.count()) > 0) {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      
      // Stability check for streaming content
      let lastText = "";
      let lastChangedAt = Date.now();
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const currentText = await locator.innerText().catch(() => "");
        if (currentText !== lastText) {
          lastText = currentText;
          lastChangedAt = Date.now();
        } else if (Date.now() - lastChangedAt > 2000 && lastText.trim()) {
          // Stable for 2 seconds and not empty
          return lastText;
        }
        await page.waitForTimeout(500);
      }

      return lastText;
    }
  }

  throw new Error("[Gemini] Response not found.");
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
