import path from "node:path";
import { app, BrowserWindow, Menu, ipcMain } from "electron";
import * as dbConfigStore from "./dbConfigStore";
import { testConnection } from "./testConnection";
import * as serverManager from "./serverManager";

let setupWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

function resourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "resources");
}

function openSetupWindow(prefill: string | null, error?: string): void {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: "Connect your database",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.setMenu(null);
  void setupWindow.loadFile(path.join(__dirname, "setup", "index.html"));
  setupWindow.on("closed", () => {
    setupWindow = null;
  });
  if (prefill || error) {
    setupWindow.webContents.once("did-finish-load", () => {
      if (prefill) {
        setupWindow?.webContents.executeJavaScript(
          `document.getElementById("connectionString").value = ${JSON.stringify(prefill)};`,
        );
      }
      if (error) {
        setupWindow?.webContents.executeJavaScript(
          `(function(){ var s = document.getElementById("status"); s.textContent = ${JSON.stringify(error)}; s.className = "error"; })();`,
        );
      }
    });
  }
}

async function openMainWindow(port: number): Promise<void> {
  if (mainWindow) {
    await mainWindow.loadURL(`http://localhost:${port}`);
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`http://localhost:${port}`);
}

async function startAppWithConnection(connectionString: string): Promise<void> {
  const port = await serverManager.start({
    connectionString,
    resourcesDir: resourcesDir(),
  });
  setupWindow?.close();
  await openMainWindow(port);
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: "Database Settings…",
          click: () => openSetupWindow(dbConfigStore.load()),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("db:test", async (_event, connectionString: string) => {
  return testConnection(connectionString);
});

ipcMain.handle("db:save", async (_event, connectionString: string) => {
  try {
    dbConfigStore.save(connectionString);
    await startAppWithConnection(connectionString);
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as const;
  }
});

app.whenReady().then(async () => {
  buildMenu();
  const saved = dbConfigStore.load();
  if (saved) {
    try {
      await startAppWithConnection(saved);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      openSetupWindow(saved, `Failed to start with saved connection: ${message}`);
    }
  } else {
    openSetupWindow(null);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let quitting = false;

app.on("before-quit", (event) => {
  if (quitting || !serverManager.isRunning()) return;
  event.preventDefault();
  quitting = true;
  void serverManager.stop().then(() => app.quit());
});
