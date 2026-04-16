import { type Request, type Response, type NextFunction } from "express";

const VP_API_KEY = process.env.VP_API_KEY || "hubert-vp-internal-2026";

export function requireVpAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey === VP_API_KEY) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: VP API key required" });
}
