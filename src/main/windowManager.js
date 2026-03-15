import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, screen } from "electron";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPreferredDisplayIndex() {
  const parsed = Number.parseInt(process.env.AGENTSYNC_DISPLAY_INDEX ?? "2", 10);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return 2;
}

function getTargetDisplay() {
  const displays = screen.getAllDisplays();
  const preferredIndex = getPreferredDisplayIndex();
  const preferredDisplay = displays[preferredIndex - 1];

  if (preferredDisplay) {
    return preferredDisplay;
  }

  if (preferredIndex === 2) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const secondaryDisplay = displays.find((display) => display.id !== primaryDisplay.id);

    if (secondaryDisplay) {
      return secondaryDisplay;
    }
  }

  return screen.getPrimaryDisplay();
}

export function createMainWindow() {
  const targetDisplay = getTargetDisplay();
  const workArea = targetDisplay.workAreaSize;
  const width = Math.min(1920, workArea.width);
  const height = Math.min(1080, workArea.height);
  const x = targetDisplay.workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2));
  const y = targetDisplay.workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2));
  const iconPath = path.join(__dirname, "../../public/hydra-icon.png");

  const window = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1080,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0d0f12",
    title: "Hydra",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }

  return window;
}
