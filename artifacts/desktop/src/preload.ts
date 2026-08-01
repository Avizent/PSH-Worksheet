import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionTestResult } from "./testConnection";

contextBridge.exposeInMainWorld("dbSetup", {
  test: (connectionString: string): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke("db:test", connectionString),
  save: (connectionString: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("db:save", connectionString),
});
