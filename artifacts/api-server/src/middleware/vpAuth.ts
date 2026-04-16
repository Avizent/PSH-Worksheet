import { type Request, type Response, type NextFunction } from "express";

export function requireVpAuth(req: Request, res: Response, next: NextFunction): void {
  const vpApiKey = process.env.VP_API_KEY;
  if (!vpApiKey) {
    res.status(500).json({ error: "VP_API_KEY not configured" });
    return;
  }
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey === vpApiKey) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: VP API key required" });
}
