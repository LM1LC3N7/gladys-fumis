// -----------------------------------------------------------------------------
// The configuration, /data and the client's error mapping.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FumisClient } from '../src/client.js';
import { DEFAULTS, normalizeConfig, parseMac, parsePin, stoveKey } from '../src/config.js';
import { TIMINGS } from '../src/constants.js';
import { FumisError, errorReason, networkError, parseRetryAfter } from '../src/http.js';
import { normalizeMemory } from '../src/store.js';
import { MAC, NOW, PIN } from './fixtures/fumis.js';

test('MAC address: separators and case accepted, the API format kept', () => {
  assert.deepEqual(parseMac('00:16:d0:a1:b2:c3'), { mac: '0016D0A1B2C3' });
  assert.deepEqual(parseMac(' 00-16-D0-A1-B2-C3 '), { mac: '0016D0A1B2C3' });
  assert.deepEqual(parseMac('0016.d0a1.b2c3'), { mac: '0016D0A1B2C3' });
  assert.deepEqual(parseMac(''), {});
  assert.deepEqual(parseMac(undefined), {});
  assert.deepEqual(parseMac('0016D0A1B2'), { error: 'invalid' });
  assert.deepEqual(parseMac('0016D0A1B2C3D4'), { error: 'invalid' });
  assert.deepEqual(parseMac('GG16D0A1B2C3'), { error: 'invalid' });
  assert.deepEqual(parseMac('x'.repeat(100)), { error: 'invalid' });
});

test('PIN: printable ASCII without spaces nor control characters', () => {
  assert.deepEqual(parsePin(` ${PIN} `), { pin: PIN });
  assert.deepEqual(parsePin(''), {});
  assert.deepEqual(parsePin(1234), {});
  assert.deepEqual(parsePin('12 34'), { error: 'invalid' });
  assert.deepEqual(parsePin('1234\r\nX: y'), { error: 'invalid' });
  assert.deepEqual(parsePin('é1234'), { error: 'invalid' });
  assert.deepEqual(parsePin('1'.repeat(65)), { error: 'invalid' });
});

test('normalizeConfig: defaults, bounds, a key without the PIN', () => {
  const config = normalizeConfig({ mac_address: MAC, pin: PIN, poll_interval: '5' });
  assert.equal(config.pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 3600);
  assert.equal(normalizeConfig({}).pollInterval, DEFAULTS.poll_interval);
  assert.equal(normalizeConfig({ language: 'DE' }).language, 'fr');
  assert.equal(config.key, stoveKey(MAC));
  assert.match(config.key, /^[0-9a-f]{32}$/);
  assert.equal(config.deviceId, config.key.slice(0, 16));
  assert.notEqual(stoveKey(MAC), stoveKey('0016D0A1B2C4'));
  assert.equal(normalizeConfig({}).deviceId, '');
});

test('/data: repaired and capped when read back', () => {
  const key = stoveKey(MAC);
  assert.deepEqual(normalizeMemory(null, NOW), { key: '', pause: null, block: null, alarms: null });
  const memory = normalizeMemory(
    {
      key,
      pause: { kind: 'rate', until: NOW + 100 * TIMINGS.rateLimitMax, failures: 99 },
      block: { retries: -1, retryAt: NOW * 10 },
      alarms: { error: 102, alert: 'x' },
    },
    NOW,
  );
  assert.equal(memory.pause.until, NOW + TIMINGS.rateLimitMax);
  assert.equal(memory.pause.failures, 10);
  assert.deepEqual(memory.block, { retries: 0, retryAt: NOW + TIMINGS.refusedRetry.at(-1) });
  // One invalid code: the whole memory is invalid, the same as none.
  assert.equal(memory.alarms, null);
  assert.equal(memory.pause.cloud, false);
  const codes = (alarms) => normalizeMemory({ key, alarms }, NOW).alarms;
  assert.deepEqual(codes({ error: 102, alert: 0 }), { error: 102, alert: 0 });
  assert.deepEqual(codes({ error: 102 }), { error: 102 }, 'an absent code: not seen yet');
  for (const bad of [-1, 1e6, '102', 1.5, null]) {
    assert.equal(codes({ error: bad, alert: 0 }), null, String(bad));
  }
  assert.equal(codes([102]), null);
  assert.equal(
    normalizeMemory({ key, pause: { kind: 'rate', until: NOW + 1, cloud: true } }, NOW).pause.cloud,
    true,
  );
  assert.equal(normalizeMemory({ key: 'bad', pause: { until: NOW + 1 } }, NOW).pause, null);
});

test('the client maps the statuses of the API', async () => {
  const answers = [
    [401, 'refused'],
    [404, 'offline'],
    [403, 'forbidden'],
    [400, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [302, 'http'],
  ];
  for (const [status, kind] of answers) {
    const client = new FumisClient({
      transport: async () => ({ status, headers: { 'retry-after': '120' }, body: '{}' }),
    });
    client.configure({ mac: MAC, pin: PIN });
    await assert.rejects(client.readNow(1000), (err) => {
      assert.equal(err.kind, kind);
      assert.ok(!err.message.includes(PIN) && !err.message.includes(MAC));
      if (kind === 'rate_limited') {
        assert.equal(err.retryAfter, 120_000);
      }
      return true;
    });
  }
  const unconfigured = new FumisClient({ transport: async () => assert.fail('sent') });
  await assert.rejects(unconfigured.readNow(1000), { kind: 'no_config' });
});

test('errors never print what they do not know', () => {
  const err = networkError(
    Object.assign(new Error(`connect to ${MAC} with ${PIN}`), { code: 'ECONNRESET' }),
  );
  assert.equal(err.message, 'connection reset');
  assert.equal(errorReason(err), 'connection reset (ECONNRESET)');
  assert.equal(errorReason(new Error(PIN)), 'internal error');
  assert.equal(networkError({ code: 'weird code!' }).message, 'network error');
  assert.ok(networkError(new FumisError('timeout', 'x')) instanceof FumisError);
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter(''), undefined);
  assert.equal(parseRetryAfter('Mon, 19 Oct 2026 10:01:00 GMT', NOW), 60_000);
});
