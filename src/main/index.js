import "dotenv/config";
import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipcHandlers.js";
import { shutdown as shutdownPlaywright } from "./playwrightManager.js";
import { startContextServer, stopContextServer } from "./serverProcess.js";
import { createMainWindow } from "./windowManager.js";

let mainWindow;
let isQuitting = false;

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
