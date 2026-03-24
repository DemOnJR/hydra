import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getHydraHome } from "../../src/shared/runtimePaths.js";
import { attachTaskArtifact } from "./taskLifecycle.js";

function ensurePreviewDir(projectId) {
  const directory = path.join(getHydraHome(), "previews", String(projectId || "global"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function capturePreview({
  taskId = null,
  projectId = null,
  url,
  waitMs = 1500,
  fullPage = true,
  viewport = { width: 1400, height: 900 }
}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    throw new Error("Preview capture requires a URL.");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const consoleEntries = [];
  const pageErrors = [];
  const networkErrors = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      });
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack || ""
    });
  });

  page.on("requestfailed", (request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "unknown"
    });
  });

  let screenshotPath = "";

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    if (waitMs > 0) {
      await page.waitForTimeout(Math.max(0, Number(waitMs) || 0));
    }

    const previewDir = ensurePreviewDir(projectId);
    screenshotPath = path.join(previewDir, `${nowStamp()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: Boolean(fullPage) });

    const result = {
      ok: true,
      url: targetUrl,
      status: response?.status() ?? null,
      screenshotPath,
      consoleEntries,
      pageErrors,
      networkErrors
    };

    if (taskId) {
      attachTaskArtifact({
        taskId,
        projectId,
        artifactType: "preview_screenshot",
        title: `Preview screenshot for ${targetUrl}`,
        filePath: screenshotPath,
        content: {
          url: targetUrl,
          status: response?.status() ?? null
        },
        correlationId: "preview"
      });

      attachTaskArtifact({
        taskId,
        projectId,
        artifactType: "preview_console",
        title: `Preview console for ${targetUrl}`,
        content: {
          consoleEntries,
          pageErrors
        },
        correlationId: "preview"
      });

      attachTaskArtifact({
        taskId,
        projectId,
        artifactType: "preview_network",
        title: `Preview network failures for ${targetUrl}`,
        content: {
          networkErrors
        },
        correlationId: "preview"
      });
    }

    return result;
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}
