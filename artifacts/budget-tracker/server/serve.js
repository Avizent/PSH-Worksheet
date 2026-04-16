/**
 * Standalone production server for Expo static builds.
 *
 * Serves:
 * - Mobile: iOS/Android manifests for Expo Go (via expo-platform header)
 * - Web: Static web build (SPA with index.html fallback)
 * - Mobile assets from timestamped directories
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const WEB_ROOT = path.join(STATIC_ROOT, "web");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function tryServeFile(root, urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
  return true;
}

function serveWebIndex(res) {
  const indexPath = path.join(WEB_ROOT, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Web build not found");
    return;
  }
  const content = fs.readFileSync(indexPath, "utf-8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(content);
}

const hasWebBuild = fs.existsSync(path.join(WEB_ROOT, "index.html"));
console.log(`Web build available: ${hasWebBuild}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && (pathname === basePath || pathname.startsWith(basePath + "/"))) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }
  }

  if (hasWebBuild) {
    if (tryServeFile(WEB_ROOT, pathname, res)) return;

    if (tryServeFile(STATIC_ROOT, pathname, res)) return;

    return serveWebIndex(res);
  }

  if (tryServeFile(STATIC_ROOT, pathname, res)) return;

  res.writeHead(404);
  res.end("Not Found");
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving on port ${port} (web: ${hasWebBuild}, basePath: "${basePath}")`);
});
