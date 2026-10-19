// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), with the stove it belongs to (a hash of its MAC address),
// bounded when read back: a pause (429, or the backoff after failures), a
// stop on a refused MAC address or PIN, and the error and alert codes last
// seen, so a restart never fires an alarm again nor misses a new one.
// Never the PIN nor the MAC address, nor a hash of the PIN (a short PIN is
// easy to find back from its hash). The file is readable by the container
// user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { POLL_INTERVAL, TIMINGS } from './constants.js';
import { readCode } from './fumis.js';

export const STATE_FILE = '/data/fumis-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** The longest backoff: 15 min, or the interval when it is longer (1 h at most). */
const BACKOFF_MAX = Math.max(TIMINGS.backoff.at(-1), POLL_INTERVAL.max * 1000);

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

/**
 * The codes seen: each a code of readCode or absent (not seen yet). Any other
 * value makes the whole memory invalid, which is the same as no memory: the
 * next read learns without firing.
 */
function alarmsOf(a) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) {
    return null;
  }
  const alarms = {};
  for (const name of ['error', 'alert']) {
    if (a[name] === undefined) {
      continue;
    }
    const value = readCode(a[name]);
    if (value === undefined) {
      return null;
    }
    alarms[name] = value;
  }
  return alarms;
}

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const key = typeof raw?.key === 'string' && /^[0-9a-f]{32}$/.test(raw.key) ? raw.key : '';
  const p = raw?.pause;
  const kind = p?.kind === 'backoff' ? 'backoff' : 'rate';
  const pause =
    key && time(p?.until)
      ? {
          kind,
          until: Math.min(p.until, now + (kind === 'rate' ? TIMINGS.rateLimitMax : BACKOFF_MAX)),
          failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 0,
          // A pause of the cloud itself (429, 5xx, network), not of this stove:
          // kept when the MAC address changes.
          cloud: p.cloud === true,
        }
      : null;
  const alarms = key ? alarmsOf(raw?.alarms) : null;
  const b = raw?.block;
  const block =
    key && b !== null && typeof b === 'object'
      ? {
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: Math.min(time(b.retryAt) ?? now, now + TIMINGS.refusedRetry.at(-1)),
        }
      : null;
  return { key, pause, block, alarms };
}
