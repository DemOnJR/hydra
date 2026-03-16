import "dotenv/config";
import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipcHandlers.js";
import { shutdown as shutdownPlaywright } from "./playwrightManager.js";
import { startContextServer, stopContextServer } from "./serverProcess.js";
import { createMainWindow } from "./windowManager.js";
import { discoverTools } from "./toolRegistry.js";

let mainWindow;
let isQuitting = false;

// Suppress Autofill protocol errors from DevTools
const originalStderrWrite = process.stderr.write;
process.stderr.write = function(chunk, encoding, callback) {
  const message = chunk.toString();
  // Filter out specific Autofill protocol errors that are harmless
  // These errors occur when DevTools tries to call Autofill methods that aren't available
  if (message.includes('ERROR:CONSOLE') && 
      message.includes('Autofill') && 
      (message.includes("wasn't found") || message.includes('failed'))) {
    return true; // Suppress the error
  }
  return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
};

app.setName("Hydra");

if (process.platform === "win32") {
  app.setAppUserModelId("com.hydra.desktop");
}

app.whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    await startContextServer();
    mainWindow = createMainWindow();
    registerIpcHandlers();

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createMainWindow();
        registerIpcHandlers();
      }
    });
  })
  .catch((error) => {
    console.error("[Hydra] Startup failed", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;

  Promise.resolve()
    .then(() => shutdownPlaywright())
    .catch((error) => {
      console.error("[Hydra] Playwright shutdown failed", error);
    })
    .finally(() => {
      stopContextServer();
      app.quit();
    });
});
