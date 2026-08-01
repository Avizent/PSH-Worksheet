import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopDir = path.join(repoRoot, "artifacts", "desktop");
const resourcesDir = path.join(desktopDir, "resources");

function run(command: string, args: string[]): void {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", cwd: repoRoot });
}

// 1. Build the API server (bundles src -> dist/index.mjs, copies drizzle migrations)
run("pnpm", ["--filter", "@workspace/api-server", "build"]);

// 2. Build the Expo web export (static-build/web). Bypassing the package's
// own `build` script here: it also builds native Expo-Go bundles/manifests,
// which require Replit-only env vars we don't have and don't need for a
// desktop/web build.
run("pnpm", [
  "--filter",
  "@workspace/budget-tracker",
  "exec",
  "expo",
  "export",
  "--platform",
  "web",
  "--output-dir",
  "static-build/web",
]);

// 3. Build the Electron main/preload bundle
run("pnpm", ["--filter", "@workspace/desktop", "build"]);

// 4. Stage resources for electron-builder's extraResources
rmSync(resourcesDir, { recursive: true, force: true });
mkdirSync(resourcesDir, { recursive: true });

// pnpm deploy resolves workspace deps into a real, non-symlinked node_modules
// so the api-server's externalized deps (e.g. pdfkit) work when spawned
// outside the monorepo as a plain `node` child process.
run("pnpm", [
  "--filter",
  "@workspace/api-server",
  "deploy",
  "--legacy",
  "--prod",
  path.join(resourcesDir, "api-server"),
]);

cpSync(
  path.join(repoRoot, "artifacts", "budget-tracker", "static-build", "web"),
  path.join(resourcesDir, "budget-tracker-web"),
  { recursive: true },
);

console.log(`Desktop resources staged at ${resourcesDir}`);
console.log("Run `pnpm --filter @workspace/desktop package` to build the .app/.dmg");
