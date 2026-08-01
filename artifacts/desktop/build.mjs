import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm, cp } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: {
      main: path.resolve(artifactDir, "src/main.ts"),
      preload: path.resolve(artifactDir, "src/preload.ts"),
    },
    platform: "node",
    bundle: true,
    format: "cjs",
    outdir: distDir,
    external: ["electron"],
    logLevel: "info",
    sourcemap: "linked",
  });

  await cp(
    path.resolve(artifactDir, "src/setup"),
    path.join(distDir, "setup"),
    { recursive: true },
  );
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
