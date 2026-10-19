// -----------------------------------------------------------------------------
// A fake WiRCU cloud behind the transport of the client (no network): it
// checks the MAC address and the PIN in the headers like the API, answers the
// current document, and can be told to fail. It records every request with
// its time, to check the spacing of the reads.
// -----------------------------------------------------------------------------

import { FumisError } from '../../src/http.js';
import { MAC, PIN, clouDuo, json } from '../fixtures/fumis.js';

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };

export function fakeCloud({ mac = MAC, pin = PIN, document = clouDuo() } = {}) {
  const server = {
    mac,
    pin,
    document,
    /** Answers to give before the document: { status, body?, headers? } or an Error. */
    queue: [],
    requests: [],
    /** Milliseconds before each answer. */
    delay: 0,
    transport: async (url, { headers = {}, timeout } = {}) => {
      server.requests.push({ at: Date.now(), url, headers: { ...headers }, timeout });
      if (server.delay > 0) {
        // A slow cloud (the timers are mocked: the test moves the clock).
        await new Promise((resolve) => setTimeout(resolve, server.delay));
      }
      const next = server.queue.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next) {
        return { headers: JSON_TYPE, body: '', ...next };
      }
      if (headers.username !== server.mac || headers.password !== server.pin) {
        return {
          status: 401,
          headers: JSON_TYPE,
          body: json({
            message: "A unit controller with that mac and pin doesn't exist",
            code: 401,
          }),
        };
      }
      return { status: 200, headers: JSON_TYPE, body: json(server.document) };
    },
    failNetwork(code = 'ENOTFOUND') {
      server.queue.push(new FumisError('network', 'unknown host name', { code }));
    },
    stoveOffline() {
      server.queue.push({
        status: 404,
        body: json({ message: 'Stove not connected', code: 404 }),
      });
    },
  };
  return server;
}

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
