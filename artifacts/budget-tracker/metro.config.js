const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith("/api/")) {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": "Content-Type, Authorization",
            "access-control-max-age": "86400",
          });
          res.end();
          return;
        }

        const targetPort = process.env.API_PORT || "8080";
        const options = {
          hostname: "localhost",
          port: parseInt(targetPort, 10),
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `localhost:${targetPort}` },
          timeout: 15000,
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, {
            ...proxyRes.headers,
            "access-control-allow-origin": "*",
          });
          proxyRes.pipe(res);
        });

        proxyReq.on("timeout", () => {
          proxyReq.destroy();
          res.writeHead(504);
          res.end(JSON.stringify({ error: "API server timeout" }));
        });

        proxyReq.on("error", (err) => {
          console.error("[proxy] Error connecting to API server:", err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: "API server unavailable" }));
        });

        req.pipe(proxyReq);
        return;
      }

      return middleware(req, res, next);
    };
  },
};

module.exports = config;
