'use strict';

// In-memory failure counter: blocks a key after maxFailures within windowMs.
function createFailureLimiter({ maxFailures, windowMs }) {
  const failures = new Map();

  function recent(key, now) {
    const list = (failures.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length > 0) failures.set(key, list);
    else failures.delete(key);
    return list;
  }

  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const key of failures.keys()) recent(key, now);
  }, windowMs);
  pruneTimer.unref();

  return {
    // Seconds until the key may try again, or 0 if it is not blocked.
    retryAfterSeconds(key) {
      const now = Date.now();
      const list = recent(key, now);
      if (list.length < maxFailures) return 0;
      return Math.max(1, Math.ceil((list[list.length - maxFailures] + windowMs - now) / 1000));
    },
    recordFailure(key) {
      const now = Date.now();
      const list = recent(key, now);
      list.push(now);
      failures.set(key, list);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

// Counts every request: take(key) returns 0 and records the request while under the
// limit, otherwise the seconds until the key may try again (nothing recorded).
function createRequestLimiter({ maxRequests, windowMs }) {
  const limiter = createFailureLimiter({ maxFailures: maxRequests, windowMs });
  return {
    take(key) {
      const retryAfter = limiter.retryAfterSeconds(key);
      if (retryAfter > 0) return retryAfter;
      limiter.recordFailure(key);
      return 0;
    },
  };
}

module.exports = { createFailureLimiter, createRequestLimiter };
