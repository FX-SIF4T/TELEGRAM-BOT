import crypto from 'node:crypto';

const PASSWORD_MAX_LENGTH = 1024;

export function isDashboardPasswordConfigured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function verifyDashboardPassword(configuredPassword, candidate) {
  if (
    !isDashboardPasswordConfigured(configuredPassword) ||
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.length > PASSWORD_MAX_LENGTH
  ) {
    return false;
  }

  const configuredHash = crypto.createHash('sha256').update(configuredPassword).digest();
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(configuredHash, candidateHash);
}

export function allowTokenAccessAttempt(attempts, address, now = Date.now(), limit = 5, windowMs = 15 * 60 * 1000) {
  const key = String(address || 'unknown');
  let entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  if (entry.count >= limit) {
    attempts.set(key, entry);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  entry.count += 1;
  attempts.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}
