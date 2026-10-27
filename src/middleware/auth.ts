import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

/**
 * Shared passcode authentication middleware for production deployments.
 * If AUTH_PASSCODE is not set, requests pass through freely (development mode).
 * If set, callers must provide 'x-anvil-passcode' header matching the secret.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Always permit CORS preflight and health checks without passcode
  if (req.method === "OPTIONS" || req.path === "/health") {
    return next();
  }

  // If no passcode is configured on the server, allow all requests
  if (!config.AUTH_PASSCODE) {
    return next();
  }

  const headerPasscode =
    req.headers["x-anvil-passcode"] ??
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!headerPasscode || headerPasscode !== config.AUTH_PASSCODE) {
    res.status(401).json({
      error: "Unauthorized: Invalid or missing passcode. Provide 'x-anvil-passcode' header.",
    });
    return;
  }

  next();
}
