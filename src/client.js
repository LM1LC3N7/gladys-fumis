// -----------------------------------------------------------------------------
// The client of the WiRCU cloud: `GET https://api.fumis.si/v1/status` with the
// MAC address and the PIN as the `username` and `password` headers (as the
// reference sends them), one request at a time, never two closer than 3 s.
// The headers are built here only and never leave this file (no log, no
// error message, no status). Read only: this client has no write method.
//
// Ported in part from frenck/python-fumis 0.4.2 (MIT), changed: see
// THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import { API, TIMINGS } from './constants.js';
import { FumisError, httpsGet, parseRetryAfter } from './http.js';
import { parseBody } from './fumis.js';

export class FumisClient {
  constructor({ transport = httpsGet, now = Date.now, timers = globalThis } = {}) {
    this.transport = transport;
    this.now = now;
    this.timers = timers;
    this.mac = '';
    this.pin = '';
    this.lastRequestAt = -Infinity;
    this.queue = Promise.resolve();
  }

  configure({ mac, pin }) {
    this.mac = mac ?? '';
    this.pin = pin ?? '';
  }

  get configured() {
    return this.mac !== '' && this.pin !== '';
  }

  /** The request headers. Never logged: they hold the MAC address and the PIN. */
  headers() {
    // No `appname`: the reference does not send it.
    return {
      Accept: 'application/json',
      'User-Agent': API.userAgent,
      username: this.mac,
      password: this.pin,
    };
  }

  sleep(ms) {
    return new Promise((resolve) => this.timers.setTimeout(resolve, ms));
  }

  /** One read, after the previous one and at least 3 s after it: the parsed answer. */
  read({ timeout = TIMINGS.requestTimeout } = {}) {
    const run = this.queue.catch(() => {}).then(() => this.readNow(timeout));
    this.queue = run.catch(() => {});
    return run;
  }

  async readNow(timeout) {
    if (!this.configured) {
      throw new FumisError('no_config', 'no MAC address or no PIN');
    }
    const wait = this.lastRequestAt + TIMINGS.minRequestGap - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    // Counted from the attempt: a failed request is spaced too.
    this.lastRequestAt = this.now();
    const { status, headers, body } = await this.transport(API.statusUrl, {
      headers: this.headers(),
      timeout,
    });
    if (status === 200) {
      const type = String(headers?.['content-type'] ?? '');
      if (type !== '' && !/application\/json/i.test(type)) {
        throw new FumisError('bad_response', 'the answer is not JSON', { status });
      }
      return parseBody(body);
    }
    if (status === 401) {
      throw new FumisError('refused', 'the cloud refused the MAC address or the PIN', { status });
    }
    if (status === 404) {
      throw new FumisError('offline', 'the stove is not connected to the cloud', { status });
    }
    if (status === 400 || status === 403) {
      // Not the credentials (401): the request itself, maybe a refusal of
      // third-party clients. A backoff, never a stop.
      throw new FumisError('forbidden', 'the cloud refused the request', { status });
    }
    if (status === 429) {
      throw new FumisError('rate_limited', 'too many requests', {
        status,
        retryAfter: parseRetryAfter(headers?.['retry-after'], this.now()),
      });
    }
    if (status >= 500 && status < 600) {
      throw new FumisError('unavailable', 'the cloud answered an error', { status });
    }
    throw new FumisError('http', 'unexpected answer', { status });
  }
}
