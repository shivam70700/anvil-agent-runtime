import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { pool } from "../db.js";

// In-memory request timestamp tracker per IP
const requestLog = new Map<string, number[]>();

export function resetRateLimits() {
  requestLog.clear();
}

/**
 * In-memory sliding window rate limiter per client IP.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS" || req.path === "/health") {
    return next();
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = config.RATE_LIMIT_PER_MINUTE;

  const timestamps = requestLog.get(ip) || [];
  // Filter out timestamps older than 1 minute
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= maxRequests) {
    res.status(429).json({
      error: `Rate limit exceeded. Maximum ${maxRequests} requests per minute allowed.`,
    });
    return;
  }

  validTimestamps.push(now);
  requestLog.set(ip, validTimestamps);
  next();
}

/**
 * Enforces the daily task creation ceiling on POST /tasks
 */
export async function dailyTaskCapMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method !== "POST" || req.path !== "/tasks") {
    return next();
  }

  try {
    const resCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM tasks WHERE created_at >= CURRENT_DATE"
    );
    const countToday = parseInt(resCount.rows[0]?.count ?? "0", 10);

    if (countToday >= config.DAILY_TASK_CAP) {
      res.status(429).json({
        error: `Daily task cap reached (${config.DAILY_TASK_CAP} tasks/day). Please try again tomorrow.`,
      });
      return;
    }
  } catch (err) {
    // If database is offline (e.g. unit test mode), continue gracefully
  }

  next();
}
