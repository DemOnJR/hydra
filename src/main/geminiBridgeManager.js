import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChromePath } from "./chromeFinder.js";
import { getSessionsDir } from "../shared/runtimePaths.js";

const GEMINI_URL = "https://gemini.google.com/app";
const DEBUG_PORT_BASE = 9333;
const DEBUG_PORT_RANGE = 1000;
const activeSessions = new Map();
const TEMPORARY_UNAVAILABLE_PATTERNS = [
  /out of free messages/i,
  /free messages until/i,
  /message limit/i,
  /usage limit/i,
  /quota exceeded/i,
  /rate limit exceeded/i,
  /too many messages/i,
  /try again later/i
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getProfileDir(agentId) {
  return path.join(getSessionsDir(), `agent-${agentId}`, "external-profile");
}

function hashAgentId(agentId) {
  let hash = 0;

  for (const character of agentId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function getDebugPort(agentId) {
  return DEBUG_PORT_BASE + (hashAgentId(agentId) % DEBUG_PORT_RANGE);
}

function getDebugBaseUrl(agentId) {
  return `http://127.0.0.1:${getDebugPort(agentId)}`;
}

function extractTemporaryUnavailableMessage(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "";
  }

  return TEMPORARY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(text))
    ? text.slice(0, 240)
    : "";
}

async function loadChromium() {
  const playwright = await import("playwright");
  return playwright.chromium;
}

async function loadGeminiAdapter() {
  return import("../../injectors/gemini.js");
}

async function readAvailabilityMessageFromPage(page) {
  try {
    const text = await page.locator("body").evaluate((node) => node.innerText || "");
    return extractTemporaryUnavailableMessage(text);
  } catch {
    return "";
  }
}

async function fetchDebuggerVersion(agentId) {
  try {
    const response = await fetch(`${getDebugBaseUrl(agentId)}/json/version`);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

async function isDebuggerReady(agentId) {
  const version = await fetchDebuggerVersion(agentId);
  return Boolean(version?.webSocketDebuggerUrl);
}

export async function isGeminiSessionConnected(agentId) {
  const existing = activeSessions.get(agentId);

  if (existing?.browser?.isConnected?.()) {
    return true;
  }

  return isDebuggerReady(agentId);
}

function launchGeminiBrowser(agentId) {
  const browserPath = findChromePath();
  const profileDir = getProfileDir(agentId);

  fs.mkdirSync(profileDir, { recursive: true });

  const child = spawn(
    browserPath,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${getDebugPort(agentId)}`,
      "--no-first-run",
      "--no-default-browser-check",
      GEMINI_URL
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );

  child.unref();
}

async function ensureGeminiBrowser(agentId, timeoutMs = 20000) {
  if (await isDebuggerReady(agentId)) {
    return;
  }

  launchGeminiBrowser(agentId);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isDebuggerReady(agentId)) {
      return;
    }

    await sleep(1000);
  }

  throw new Error("Gemini browser did not expose its local debugging port in time.");
}

async function connectGeminiBrowser(agentId) {
  const chromium = await loadChromium();
  return chromium.connectOverCDP(getDebugBaseUrl(agentId));
}

async function ensureGeminiSession(agentId) {
  const existing = activeSessions.get(agentId);

  if (existing?.browser?.isConnected()) {
    const openPage =
      existing.context
        ?.pages()
        .find((candidate) => !candidate.isClosed() && candidate.url().includes("gemini.google.com")) ||
      existing.context?.pages().find((candidate) => !candidate.isClosed()) ||
      null;

    if (openPage) {
      existing.page = openPage;
      return existing;
    }
  }

  await ensureGeminiBrowser(agentId);
  const browser = await connectGeminiBrowser(agentId);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("Gemini browser did not expose a usable browsing context.");
  }

  const session = {
    agentId,
    browser,
    context,
    page:
      context.pages().find((candidate) => !candidate.isClosed() && candidate.url().includes("gemini.google.com")) ||
      context.pages().find((candidate) => !candidate.isClosed()) ||
      (await context.newPage())
  };

  browser.on("disconnected", () => {
    activeSessions.delete(agentId);
  });

  activeSessions.set(agentId, session);
  return session;
}

export async function openGeminiAgent(agentId) {
  await ensureGeminiBrowser(agentId);

  return {
    url: GEMINI_URL,
    profileDir: getProfileDir(agentId),
    debugPort: getDebugPort(agentId)
  };
}

export async function inspectGeminiAgent(agentId, platformUrl) {
  const adapter = await loadGeminiAdapter();
  const session = await ensureGeminiSession(agentId);

  if (!session.page.url().includes("gemini.google.com")) {
    await session.page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
  }

  await session.page.bringToFront();

  return {
    url: session.page.url() || platformUrl || GEMINI_URL,
    loggedIn: adapter.isLoggedIn ? await adapter.isLoggedIn(session.page) : false,
    bridgeConnected: true,
    busy: false
  };
}

export async function sendGeminiPrompt(agentId, prompt, timeoutMs = 240000) {
  const adapter = await loadGeminiAdapter();
  const session = await ensureGeminiSession(agentId);

  if (!session.page.url().includes("gemini.google.com")) {
    await session.page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
  }

  await session.page.bringToFront();
  const loggedIn = adapter.isLoggedIn ? await adapter.isLoggedIn(session.page) : false;

  if (!loggedIn) {
    throw new Error("Gemini browser is open but not logged in yet.");
  }

  try {
    await adapter.inject(session.page, prompt);
    return await adapter.waitForResponse(session.page, timeoutMs);
  } catch (error) {
    const availabilityMessage = await readAvailabilityMessageFromPage(session.page);

    if (availabilityMessage) {
      throw new Error(availabilityMessage);
    }

    throw error;
  }
}
