/**
 * SAMI COINS - Lightweight API rate limiting
 *
 * In-memory limiter for the single-process PM2 deployment.
 * It is deliberately small and dependency-free. If the service
 * is later horizontally scaled, move the counter store to Redis.
 */

const buckets = new Map();

function defaultKey(req) {
  // Never trust a client-supplied X-Forwarded-For value.
  // Express req.ip already honors it only when trust proxy is configured.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  keyGenerator = defaultKey,
  message = "عدد الطلبات مرتفع جدًا. حاول مرة أخرى لاحقًا."
} = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Invalid rate limiter window.");
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("Invalid rate limiter maximum.");
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = String(keyGenerator(req) || "unknown");
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message
      });
    }

    return next();
  };
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

export default createRateLimiter;
