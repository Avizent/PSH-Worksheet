import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";

export type StartOptions = {
  connectionString: string;
  resourcesDir: string;
};

let child: ChildProcess | null = null;
let port = 0;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const chosen = address.port;
        srv.close(() => resolve(chosen));
      } else {
        srv.close(() => reject(new Error("Could not determine a free port")));
      }
    });
    srv.on("error", reject);
  });
}

// First launch against a fresh remote database has to run schema
// migrations before /api/healthz reports ready, which observed ~13s
// against a real Supabase pooler - leave comfortable headroom.
function waitForHealth(targetPort: number, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  const attempt = (): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port: targetPort, path: "/api/healthz", timeout: 1500 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await attempt()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Server did not become healthy in time"));
        return;
      }
      setTimeout(tick, 300);
    };
    void tick();
  });
}

export async function start({ connectionString, resourcesDir }: StartOptions): Promise<number> {
  if (child) {
    await stop();
  }

  port = await getFreePort();

  child = spawn(
    process.execPath,
    [path.join(resourcesDir, "api-server", "dist", "index.mjs")],
    {
      env: {
        ...process.env,
        // process.execPath is the Electron binary, not plain Node; without
        // this it launches itself as a GUI app instead of running the
        // script, and the child never actually starts listening.
        ELECTRON_RUN_AS_NODE: "1",
        DATABASE_URL: connectionString,
        PORT: String(port),
        SERVE_STATIC_DIR: path.join(resourcesDir, "budget-tracker-web"),
        NODE_ENV: "production",
      },
      stdio: "inherit",
    },
  );

  await waitForHealth(port);
  return port;
}

export function getPort(): number {
  return port;
}

export function isRunning(): boolean {
  return child !== null;
}

export function stop(): Promise<void> {
  if (!child) return Promise.resolve();
  const proc = child;
  child = null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}
