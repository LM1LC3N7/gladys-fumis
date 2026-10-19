// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake WiRCU cloud behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FumisApp } from '../src/app.js';
import { stoveKey } from '../src/config.js';
import { ACTIONS, API, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  CONFIG,
  MAC,
  MAC_TYPED,
  MINUTE,
  NOW,
  PIN,
  SECOND,
  clouDuo,
  simpleStove,
} from './fixtures/fumis.js';
import { fakeCloud, memoryStore, settle } from './helpers/fakeCloud.js';

const STOVE = stoveKey(MAC).slice(0, 16);
const dev = (id = STOVE) => `ext:test-integration:fumis:${id}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  { config = CONFIG, store = memoryStore(), server = fakeCloud(), create = true, logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new FumisApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

const last = (gladys, role, id = STOVE) => gladys.fake.lastState(`${dev(id)}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badgeOf = (gladys, id = STOVE) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(id)).at(-1);
const restart = (t, { server, store, config = CONFIG, gladys = createFakeGladys({ config }) }) => {
  const again = new FumisApp({
    gladys,
    transport: server.transport,
    now: () => Date.now(),
    store,
    logger: recorder([]),
  });
  t.after(() => again.stop());
  return again;
};

/** Neither the PIN nor the MAC address, in any spelling. */
function assertNoSecret(where, text) {
  assert.ok(!text.includes(PIN), `${where} holds the PIN`);
  for (const mac of [MAC, MAC.toLowerCase(), MAC_TYPED, MAC_TYPED.toUpperCase()]) {
    assert.ok(!text.includes(mac), `${where} holds the MAC address`);
  }
}

test('without a MAC address or a PIN, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { mac_address: MAC_TYPED, pin: '' } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse MAC et le code PIN/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /MAC address and the PIN/);
  assert.equal(server.requests.length, 0);
});

test('an invalid MAC address or PIN is refused, never sent nor echoed', async (t) => {
  const logs = [];
  const { gladys, server } = await setup(t, {
    config: { mac_address: '00:16:D0:XX:B2:C3', pin: PIN },
    logs,
  });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).en, /MAC address is not valid/);
  assertNoSecret('statuses', JSON.stringify(gladys.fake.connectionStatuses));
});

test('a PIN with spaces or control characters is refused, never sent nor echoed', async (t) => {
  const logs = [];
  const { gladys, server } = await setup(t, {
    config: { mac_address: MAC_TYPED, pin: 'with space\r\nX-Evil: 1' },
    logs,
  });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).fr, /code PIN n’est pas valide/);
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('X-Evil'));
  assert.ok(!logs.join('\n').includes('X-Evil'));
});

test('start: one read with our own headers, the stove as a device, its states, connected', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  assert.equal(server.requests.length, 1);
  const [request] = server.requests;
  assert.equal(request.url, 'https://api.fumis.si/v1/status');
  assert.equal(request.headers.username, MAC, 'the MAC address in the API format');
  assert.equal(request.headers.password, PIN);
  assert.equal(request.headers['User-Agent'], API.userAgent);
  assert.match(request.headers['User-Agent'], /^gladys-fumis /, 'our own name, no imitation');
  assert.equal(request.headers.appname, 'gladys-fumis');
  assert.ok(!request.url.includes(PIN) && !request.url.includes(MAC), 'no secret in the URL');
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [dev()],
  );
  const device = gladys.fake.discoveredDevices[0];
  assert.equal(device.name, 'Poêle Austroflamm Clou Duo');
  assert.ok(device.features.every((f) => f.read_only === true));
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected: stove read (read only).',
      fr: 'Connecté : poêle lu (lecture seule).',
    },
  });
  t.mock.timers.tick(SECOND);
  await settle();
  assert.equal(last(gladys, 'state'), 'En chauffe');
  assert.equal(last(gladys, 'phase'), 'Combustion');
  assert.equal(last(gladys, 'active'), 1);
  assert.equal(last(gladys, 'room-temperature'), 20.3);
  assert.equal(last(gladys, 'target-temperature'), 21.5);
  assert.equal(last(gladys, 'combustion-temperature'), 190);
  assert.equal(last(gladys, 'power-level'), 5);
  assert.equal(last(gladys, 'heat-output'), 5.7);
  assert.equal(last(gladys, 'fuel-level'), 95);
  assert.equal(last(gladys, 'error'), 0);
  assert.equal(last(gladys, 'error-code'), 'Aucune erreur');
  assert.equal(last(gladys, 'warning-code'), 'Aucun avertissement');
  assert.equal(last(gladys, 'door-open'), 0);
  assert.equal(last(gladys, 'eco-mode'), 0);
  assert.equal(last(gladys, 'time-to-service'), 2160);
  assert.equal(last(gladys, 'burning-hours'), 506.5);
  assert.equal(last(gladys, 'igniter-starts'), 392);
  assert.equal(last(gladys, 'misfires'), 2);
  assert.equal(last(gladys, 'wifi-signal'), 100);
  assert.equal(badgeOf(gladys).transport, 'cloud');
  // No secret anywhere Gladys or the logs see, nor in /data.
  assertNoSecret('logs', logs.join('\n'));
  assertNoSecret('requests to Gladys', JSON.stringify(gladys.fake.requests));
  assertNoSecret('statuses', JSON.stringify(gladys.fake.connectionStatuses));
  assertNoSecret('/data', JSON.stringify(store.data));
  assert.equal(store.data.key, stoveKey(MAC));
});

test('read only: a command is refused and nothing is sent to the cloud', async (t) => {
  const { gladys, server } = await setup(t);
  const device = gladys.fake.discoveredDevices[0];
  const before = server.requests.length;
  for (const role of ['active', 'target-temperature', 'power-level', 'eco-mode']) {
    const feature = device.features.find((f) => f.external_id.endsWith(`:${role}`));
    const ack = await gladys.fake.setValue(device, feature, 1);
    assert.equal(ack.success, false);
    assert.match(JSON.stringify(ack), /lecture seule/);
  }
  assert.equal(server.requests.length, before);
  // No switch, no thermostat: nothing an "all off" or a voice assistant could drive.
  for (const feature of device.features) {
    assert.notEqual(feature.category, 'switch');
    assert.notEqual(feature.category, 'thermostat');
    assert.notEqual(feature.category, 'energy-sensor');
  }
});

test('reads every interval, never closer; an interval below 60 s is raised', async (t) => {
  const { server, advance, app } = await setup(t, { config: { ...CONFIG, poll_interval: 10 } });
  assert.equal(app.config.pollInterval, 60);
  await advance(5 * MINUTE);
  const at = server.requests.map((r) => r.at);
  assert.equal(at.length, 6);
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] - at[i - 1] >= MINUTE, `reads ${i - 1} and ${i} too close`);
  }
});

test('refused credentials stop the reads, spaced new tries, kept across a restart', async (t) => {
  const server = fakeCloud({ pin: 'other' });
  const store = memoryStore();
  const { gladys, advance, app } = await setup(t, { server, store });
  assert.equal(server.requests.length, 1);
  assert.match(message(gladys).fr, /refusé l’adresse MAC ou le code PIN.*10 min/);
  assert.equal(store.data.block.retries, 1);
  assert.equal(gladys.fake.discoveredDevices.length, 0, 'nothing published before a read');
  await advance(9 * MINUTE);
  assert.equal(server.requests.length, 1, 'no read during the stop');
  await advance(MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 2);
  assert.match(message(gladys).en, /New try in 60 min/);
  // A restart keeps the stop: no read at once.
  app.stop();
  const again = restart(t, { server, store });
  await again.start(CONFIG);
  assert.equal(server.requests.length, 2);
  // A new PIN lifts it at once.
  server.pin = 'new-one';
  await again.configUpdated({ ...CONFIG, pin: 'other-again' });
  assert.equal(server.requests.length, 3);
  assert.equal(again.blocked, true);
  // The test button retries at once, but only once the interval has passed.
  await advance(30 * SECOND);
  const early = await again.testConnection();
  assert.match(early.en, /next read possible in 30 s/);
  assert.equal(server.requests.length, 3);
  await advance(30 * SECOND);
  await again.configUpdated({ ...CONFIG, pin: 'new-one' });
  assert.equal(server.requests.length, 4);
  assert.equal(again.blocked, false);
  assert.equal(store.data.block, null);
});

test('a refused retry that fails without an answer keeps the stop', async (t) => {
  const server = fakeCloud({ pin: 'other' });
  const store = memoryStore();
  const { app, advance } = await setup(t, { server, store });
  await advance(MINUTE);
  server.failNetwork();
  await app.testConnection();
  assert.equal(server.requests.length, 2);
  assert.equal(app.blocked, true);
  assert.ok(store.data.block, 'the stop is still in /data');
  const during = await app.testConnection();
  assert.match(during.fr, /prochaine lecture possible dans/);
  assert.equal(server.requests.length, 2);
});

test('the stove offline (404): a backoff, an unreachable badge, then back', async (t) => {
  const server = fakeCloud();
  const store = memoryStore();
  const { gladys, advance } = await setup(t, { server, store });
  server.stoveOffline();
  await advance(MINUTE);
  assert.match(message(gladys).fr, /poêle n’y est pas connecté.*60 s/);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(badgeOf(gladys).transport, 'unreachable');
  assert.equal(store.data.pause.kind, 'backoff');
  assert.equal(store.data.block, null, 'an offline stove is no refused PIN');
  server.stoveOffline();
  await advance(MINUTE);
  assert.match(message(gladys).en, /not connected to it.*2 min/);
  await advance(MINUTE);
  assert.equal(server.requests.length, 3, 'the backoff holds');
  await advance(MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 4);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badgeOf(gladys).transport, 'cloud');
  assert.equal(store.data.pause, null);
});

test('the backoff is kept across a restart: no read at once', async (t) => {
  const server = fakeCloud();
  const store = memoryStore();
  const { app, advance } = await setup(t, { server, store });
  server.failNetwork();
  server.failNetwork();
  await advance(MINUTE);
  await advance(MINUTE);
  assert.equal(server.requests.length, 3);
  assert.equal(store.data.pause.failures, 2);
  const until = store.data.pause.until;
  assert.equal(until, NOW + 2 * MINUTE + 2 * MINUTE);
  app.stop();
  const again = restart(t, { server, store });
  await again.start(CONFIG);
  assert.equal(server.requests.length, 3, 'no read at the restart');
  assert.match(again.lastMessage.en, /Waiting before the next read/);
  await advance(until - Date.now() - SECOND);
  assert.equal(server.requests.length, 3);
  await advance(5 * SECOND);
  assert.equal(server.requests.length, 4, 'read when the pause ends');
});

test('429: a pause for every path, kept in /data and across a reconnection to Gladys', async (t) => {
  const server = fakeCloud();
  const store = memoryStore();
  const { gladys, advance } = await setup(t, { server, store });
  server.queue.push({ status: 429, headers: { 'retry-after': '1800' } });
  await advance(MINUTE);
  assert.match(message(gladys).en, /HTTP 429.*30 min/);
  assert.ok(store.data.pause.until >= NOW + 30 * MINUTE);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /HTTP 429/);
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  await gladys.fake.scanRequest();
  await advance(20 * MINUTE);
  assert.equal(server.requests.length, 2, 'no read during the pause');
  await advance(10 * MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 3);
  assert.equal(store.data.pause, null);
});

test('5xx, 403 and a non-JSON answer back off, never faster than the interval', async (t) => {
  const server = fakeCloud();
  const { gladys, advance, app } = await setup(t, { server });
  server.queue.push({ status: 503, body: 'Service Unavailable' });
  await advance(MINUTE);
  assert.match(message(gladys).fr, /cloud Fumis a répondu une erreur \(HTTP 503\)/);
  server.queue.push({ status: 403, body: '<html>blocked</html>', headers: {} });
  await advance(MINUTE);
  assert.match(message(gladys).en, /refused the request \(HTTP 403\).*2 min/);
  assert.equal(app.blocked, false, 'a 403 is no refused PIN');
  await advance(MINUTE);
  assert.equal(server.requests.length, 3, 'the backoff holds');
  await advance(MINUTE + 5 * SECOND);
  assert.equal(server.requests.length, 4);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  server.queue.push({
    status: 200,
    body: '<html>maintenance</html>',
    headers: { 'content-type': 'text/html' },
  });
  await advance(MINUTE);
  assert.equal(server.requests.length, 5);
  assert.match(message(gladys).en, /not the expected JSON/);
});

test('a hostile answer: no prototype pollution, lists cut, values checked', async (t) => {
  const document = clouDuo();
  const hostile = JSON.stringify(document).replace(
    '"controller":{',
    '"__proto__":{"polluted":1},"controller":{"constructor":{"prototype":{"polluted":1}},',
  );
  const big = clouDuo();
  big.controller.temperatures = Array.from({ length: 5000 }, (_, i) => ({ id: i, actual: 1e9 }));
  const server = fakeCloud();
  server.queue.push({ status: 200, body: hostile });
  const { gladys, advance } = await setup(t, { server });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  server.queue.push({ status: 200, body: JSON.stringify(big) });
  await advance(MINUTE + SECOND);
  // The room temperature out of range: no value sent, the feature kept.
  assert.ok(
    gladys.fake.discoveredDevices[0].features.some((f) =>
      f.external_id.endsWith(':room-temperature'),
    ),
  );
});

test('a reconnection to Gladys resends the status and the Discovery list', async (t) => {
  const { gladys } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const lists = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, lists + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('scene trigger: a new error or warning code, once; never on the first read', async (t) => {
  const server = fakeCloud({ document: clouDuo({ error: 102 }) });
  const store = memoryStore();
  const { gladys, app, advance } = await setup(t, { server, store });
  await advance(SECOND);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never on the first read');
  assert.equal(last(gladys, 'error'), 1);
  assert.equal(
    last(gladys, 'error-code'),
    'E102 : Cheminée ou creuset encrassé, ou arrêt manuel avant la détection de flamme',
  );
  // Still E102: nothing; then cleared, then back: fires.
  await advance(MINUTE);
  server.document = clouDuo();
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  server.document = clouDuo({ error: 102, alert: 1 });
  await advance(MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data]),
    [
      [
        SCENE_TRIGGERS.ALARM,
        {
          message:
            'E102 : Cheminée ou creuset encrassé, ou arrêt manuel avant la détection de flamme',
          code: 'E102',
          kind: 'error',
        },
      ],
      [
        SCENE_TRIGGERS.ALARM,
        { message: 'A001 : Niveau de granulés bas', code: 'A001', kind: 'warning' },
      ],
    ],
  );
  // An unknown code fires with its number.
  server.document = clouDuo({ error: 999, alert: 1 });
  await advance(MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, {
    message: 'E999 : Erreur inconnue',
    code: 'E999',
    kind: 'error',
  });
  assert.equal(gladys.fake.sceneEvents.length, 3);
  // A restart remembers the codes seen: nothing fires again.
  app.stop();
  const fresh = createFakeGladys({ config: CONFIG });
  const again = restart(t, { server, store, gladys: fresh });
  await advance(MINUTE);
  await again.start(CONFIG);
  await advance(2 * SECOND);
  assert.equal(fresh.fake.sceneEvents.length, 0);
});

test('a created device keeps its features when the answer lacks values', async (t) => {
  const server = fakeCloud();
  const { gladys, advance } = await setup(t, { server });
  const before = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  server.document = simpleStove();
  await advance(MINUTE);
  const after = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.deepEqual(after, before);
  assert.equal(last(gladys, 'state'), 'Arrêt');
  assert.equal(last(gladys, 'active'), 0);
});

test('a plain stove: no fuel level, no door, no combustion temperature, no service counter', async (t) => {
  const server = fakeCloud({ document: simpleStove() });
  const { gladys } = await setup(t, { server });
  const device = gladys.fake.discoveredDevices[0];
  const roles = device.features.map((f) => f.external_id.split(':').at(-1));
  for (const role of [
    'fuel-level',
    'door-open',
    'combustion-temperature',
    'time-to-service',
    'eco-mode',
  ]) {
    assert.ok(!roles.includes(role), role);
  }
  assert.equal(device.name, 'Poêle Fumis');
  assert.ok(roles.includes('room-temperature') && roles.includes('error-code'));
});

test('another MAC address: the old stove stays in Discovery, with a degraded badge', async (t) => {
  const { gladys, app } = await setup(t);
  const other = '0016D0FFEEDD';
  const server = fakeCloud({ mac: other });
  app.client.transport = server.transport;
  // The new read waits for the 3 s gap after the previous one.
  const restarted = app.configUpdated({ ...CONFIG, mac_address: other });
  await settle();
  t.mock.timers.tick(3 * SECOND);
  await restarted;
  await settle();
  assert.equal(server.requests.length, 1);
  const otherId = stoveKey(other).slice(0, 16);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [dev(otherId), dev()],
  );
  const old = gladys.fake.discoveredDevices[1];
  assert.ok(old.features.length > 10, 'the old stove keeps its features');
  assert.equal(badgeOf(gladys).degraded, true);
});

test('the test button and Discovery never read closer than the interval to the last attempt', async (t) => {
  const server = fakeCloud();
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, poll_interval: 300 } });
  const first = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(first.data.message.en, /next read possible in 5 min\. Connected/);
  await advance(31 * SECOND);
  await gladys.fake.scanRequest();
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.requests.length, 1, 'neither the button nor Discovery read');
  server.failNetwork();
  await advance(270 * SECOND);
  assert.equal(server.requests.length, 2);
  const during = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(during.data.message.en, /next read possible in 5 min\. Stove not read/);
  assert.equal(server.requests.length, 2);
});

test('the language of the names follows the configuration', async (t) => {
  const { gladys, app } = await setup(t, { config: { ...CONFIG, language: 'en' } });
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Austroflamm Clou Duo stove');
  await app.configUpdated({ ...CONFIG, language: 'fr' });
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Poêle Austroflamm Clou Duo');
});
