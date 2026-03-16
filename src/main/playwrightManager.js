import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChromePath } from "./chromeFinder.js";
import { getPlatformUrl } from "./platformUrls.js";
import { getSessionsDir } from "../shared/runtimePaths.js";
import { getProvider } from "../../injectors/index.js";

const DEBUG_PORT_BASE = 9550;
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

async function loadChromium() {
  const playwright = await import("playwright");
  return playwright.chromium;
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

async function readAvailabilityMessageFromPage(page) {
  try {
    const text = await page.locator("body").evaluate((node) => node.innerText || "");
    return extractTemporaryUnavailableMessage(text);
  } catch {
    return "";
  }
}

function getSessionDir(agentId) {
  return path.join(getSessionsDir(), `agent-${agentId}`);
}

function getProfileDir(agentId) {
  return path.join(getSessionDir(agentId), "external-profile");
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

function formatPlatformName(platform) {
  switch (platform) {
    case "chatgpt":
      return "ChatGPT";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    default:
      return "Agent";
  }
}

function normalizeHostname(value) {
  return String(value ?? "").replace(/^www\./i, "").toLowerCase();
}

function isPlatformPage(page, platformUrl) {
  const pageUrl = page?.url?.() || "";

  if (!pageUrl) {
    return false;
  }

  try {
    const expectedHost = normalizeHostname(new URL(platformUrl).hostname);
    const currentHost = normalizeHostname(new URL(pageUrl).hostname);

    return (
      currentHost === expectedHost ||
      currentHost.endsWith(`.${expectedHost}`) ||
      expectedHost.endsWith(`.${currentHost}`)
    );
  } catch {
    return false;
  }
}

function pickOpenPage(context, platformUrl) {
  return (
    context
      .pages()
      .find((candidate) => !candidate.isClosed() && isPlatformPage(candidate, platformUrl)) ||
    context.pages().find((candidate) => !candidate.isClosed()) ||
    null
  );
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

function launchAgentBrowser(agentId, platformUrl) {
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
      platformUrl
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );

  child.unref();
}

async function ensureAgentBrowser(agentId, platformUrl, timeoutMs = 20000) {
  if (await isDebuggerReady(agentId)) {
    return;
  }

  launchAgentBrowser(agentId, platformUrl);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isDebuggerReady(agentId)) {
      return;
    }

    await sleep(1000);
  }

  throw new Error("Browser did not expose its local debugging port in time.");
}

async function connectAgentBrowser(agentId) {
  const chromium = await loadChromium();
  return chromium.connectOverCDP(getDebugBaseUrl(agentId));
}

async function ensureSession(agentId, platformUrl) {
  const existing = activeSessions.get(agentId);

  if (existing?.browser?.isConnected()) {
    const openPage = pickOpenPage(existing.context, platformUrl);

    if (openPage) {
      existing.page = openPage;
      existing.platformUrl = platformUrl;
      return existing;
    }

    existing.page = await existing.context.newPage();
    existing.platformUrl = platformUrl;
    return existing;
  }

  await ensureAgentBrowser(agentId, platformUrl);
  const browser = await connectAgentBrowser(agentId);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("Browser did not expose a usable browsing context.");
  }

  const session = {
    agentId,
    browser,
    context,
    page: pickOpenPage(context, platformUrl) || (await context.newPage()),
    profileDir: getProfileDir(agentId),
    platformUrl
  };

  browser.on("disconnected", () => {
    activeSessions.delete(agentId);
  });

  activeSessions.set(agentId, session);
  return session;
}

function shouldNavigateToPlatform(page, platformUrl, force = false) {
  const currentUrl = page?.url?.() || "";

  if (isPlatformPage(page, platformUrl)) {
    return false;
  }

  if (force) {
    return true;
  }

  return (
    !currentUrl ||
    currentUrl === "about:blank" ||
    currentUrl.startsWith("data:") ||
    currentUrl.startsWith("chrome://newtab") ||
    currentUrl.startsWith("edge://newtab") ||
    currentUrl.startsWith("chrome-error://")
  );
}

async function ensurePlatformPage(session, platformUrl, options = {}) {
  if (shouldNavigateToPlatform(session.page, platformUrl, options.force === true)) {
    await session.page.goto(platformUrl, { waitUntil: "domcontentloaded" });
  }

  return session.page;
}

export function isSessionConnected(agentId) {
  const session = activeSessions.get(agentId);
  if (!session) {
    return true;
  }
  return session.browser?.isConnected() === true;
}

export async function openAgent(agentId, platformUrl) {
  await ensureAgentBrowser(agentId, platformUrl);
  const session = await ensureSession(agentId, platformUrl);
  await ensurePlatformPage(session, platformUrl, { force: true });
  await session.page.bringToFront();

  return {
    url: session.page.url() || platformUrl,
    profileDir: session.profileDir,
    debugPort: getDebugPort(agentId),
    bridgeConnected: true
  };
}

export async function inspectAgent(agentId, platform, platformUrl) {
  const session = await ensureSession(agentId, platformUrl);
  const adapter = await getProvider(platform);

  if (!adapter) {
    throw new Error(`Provider adapter for "${platform}" not found.`);
  }

  await ensurePlatformPage(session, platformUrl);
  await session.page.bringToFront();

  const loggedIn = adapter.isLoggedIn
    ? await adapter.isLoggedIn(session.page)
    : false;

  return {
    url: session.page.url() || platformUrl,
    loggedIn,
    profileDir: session.profileDir,
    debugPort: getDebugPort(agentId),
    bridgeConnected: true,
    busy: false
  };
}

export async function injectPrompt(agentId, platform, prompt) {
  const platformUrl = getPlatformUrl(platform);
  const session = await ensureSession(agentId, platformUrl);
  const adapter = await getProvider(platform);

  if (!adapter) {
    throw new Error(`Provider adapter for "${platform}" not found.`);
  }

  await ensurePlatformPage(session, platformUrl);
  await session.page.bringToFront();

  if (adapter.isLoggedIn) {
    const loggedIn = await adapter.isLoggedIn(session.page);

    if (!loggedIn) {
      throw new Error(`${formatPlatformName(platform)} browser is open but not logged in yet.`);
    }
  }

  return adapter.inject(session.page, prompt);
}

export async function waitForResponse(agentId, platform, timeoutMs = 120000, options = {}) {
  const platformUrl = getPlatformUrl(platform);
  const session = await ensureSession(agentId, platformUrl);
  const adapter = await getProvider(platform);

  if (!adapter) {
    throw new Error(`Provider adapter for "${platform}" not found.`);
  }

  try {
    return await adapter.waitForResponse(session.page, timeoutMs, options);
  } catch (error) {
    const availabilityMessage = await readAvailabilityMessageFromPage(session.page);

    if (availabilityMessage) {
      throw new Error(availabilityMessage);
    }

    throw error;
  }
}

export async function shutdown() {
  activeSessions.clear();
}
