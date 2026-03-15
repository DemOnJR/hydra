import fs from "node:fs";

function existingPaths(paths) {
  return paths.filter(Boolean).filter((candidate) => fs.existsSync(candidate));
}

export function findChromePath() {
  const candidatesByPlatform = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA &&
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium"
    ]
  };

  const matches = existingPaths(candidatesByPlatform[process.platform] || []);

  if (matches.length > 0) {
    return matches[0];
  }

  throw new Error(
    "No Chrome-family browser was found. Install Google Chrome, Chromium, or Microsoft Edge."
  );
}

