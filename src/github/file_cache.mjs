import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Build a stable cache key for a request.
 *
 * Keep this deterministic across platforms by using JSON with sorted keys.
 */
export function cacheKey(parts) {
  const stable = JSON.stringify(parts, Object.keys(parts).sort());
  return sha256Hex(stable);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cachePath(cacheDir, key) {
  return path.join(cacheDir, `${key}.json`);
}

/**
 * Read a JSON cache entry if it exists and is within TTL.
 */
export function readJsonCache({ cacheDir, key, ttlSeconds, nowMs = Date.now() }) {
  const filePath = cachePath(cacheDir, key);
  try {
    const st = fs.statSync(filePath);
    const ageSeconds = (nowMs - st.mtimeMs) / 1000;
    if (ttlSeconds !== undefined && ttlSeconds !== null && ageSeconds > ttlSeconds) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write JSON cache entry atomically.
 */
export function writeJsonCache({ cacheDir, key, value }) {
  ensureDir(cacheDir);
  const filePath = cachePath(cacheDir, key);
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

