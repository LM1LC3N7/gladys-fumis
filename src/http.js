// -----------------------------------------------------------------------------
// The only network access: one HTTPS GET to the WiRCU cloud, and the errors it
// ends with. The body read is bounded; the request headers carry the MAC
// address and the PIN, so no error message, log or status ever holds a
// header, and Node's own socket messages are replaced by their code.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed read. `kind`:
 * - `no_config`: no MAC address or no PIN (nothing sent);
 * - `refused`: the cloud refused the MAC address or the PIN (401);
 * - `offline`: the cloud does not reach the stove (404 "Stove not connected");
 * - `forbidden`: a 400 or a 403 (the request itself, maybe a refusal of
 *   third-party clients, not the credentials);
 * - `stale`: the cloud answered, but has not seen the stove for a while (src/app.js);
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: not the expected JSON;
 * - `http`: any other status.
 */
export class FumisError extends Error {
  constructor(kind, message, { status, retryAfter, code } = {}) {
    super(message);
    this.name = 'FumisError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
  CERT_HAS_EXPIRED: 'certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted certificate',
  SELF_SIGNED_CERT_IN_CHAIN: 'untrusted certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted certificate',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificate for another host',
};

/** A socket error -> FumisError, from its code only. */
export function networkError(err) {
  if (err instanceof FumisError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,40}$/.test(err.code) ? err.code : '';
  return new FumisError('network', NETWORK_REASONS[code] ?? 'network error', {
    code: code || undefined,
  });
}

/** A short, secret-free reason for a log. */
export function errorReason(err) {
  if (err instanceof FumisError) {
    const details = [err.code, err.status ? `HTTP ${err.status}` : undefined].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'internal error';
}

/**
 * One GET; resolves `{ status, headers, body }` (body: a string) whatever the
 * status. The promise settles once; the body read is bounded (a bigger answer
 * is an error, the socket is closed at once); the whole request is bounded in
 * time. Redirects are not followed.
 */
export function httpsGet(
  url,
  { headers = {}, timeout = TIMINGS.requestTimeout, maxBytes = LIMITS.responseBytes } = {},
) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    let req;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    try {
      req = https.get(url, { headers, agent: false }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            settle(reject, new FumisError('size', 'answer too large'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          settle(resolve, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (err) => settle(reject, networkError(err)));
        res.on('aborted', () => settle(reject, new FumisError('network', 'answer cut short')));
      });
    } catch (err) {
      // A header Node refuses (should not happen: the PIN is checked before).
      settle(reject, new FumisError('network', 'invalid request', { code: err?.code }));
      return;
    }
    timer = setTimeout(() => {
      settle(reject, new FumisError('timeout', `no answer within ${Math.round(timeout / 1000)} s`));
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
