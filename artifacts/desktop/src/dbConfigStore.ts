import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

function configPath(): string {
  return path.join(app.getPath("userData"), "db-connection.enc");
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level encryption (Keychain) is not available on this machine, refusing to store the database connection string.",
    );
  }
}

export function load(): string | null {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  assertEncryptionAvailable();
  return safeStorage.decryptString(fs.readFileSync(file));
}

export function save(connectionString: string): void {
  assertEncryptionAvailable();
  fs.writeFileSync(configPath(), safeStorage.encryptString(connectionString), {
    mode: 0o600,
  });
}

export function clear(): void {
  const file = configPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
