// -----------------------------------------------------------------------------
// The answer read as untrusted data, and the states of the stove (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  ROLES,
  alertText,
  buildDevice,
  errorText,
  parseDeviceId,
  parseFeatureId,
  signalStrength,
  statesOf,
} from '../src/devices.js';
import {
  ALERT_CODES,
  ERROR_CODES,
  STATUS_STATE,
  codeText,
  isActive,
  parseBody,
  readCode,
  readInfo,
  stateOf,
  toNumber,
} from '../src/fumis.js';
import { ALERT_LABELS, ERROR_LABELS, STATUS_LABELS } from '../src/i18n.js';
import { KEY_COST, normalizeConfig, stoveKey } from '../src/config.js';
import { MAC, PIN, clouDuo, json, simpleStove } from './fixtures/fumis.js';

const read = (document) => readInfo(parseBody(json(document)));
const asMap = (states) =>
  Object.fromEntries(states.map(({ role, ...v }) => [role, v.state ?? v.text]));

test('parseBody: JSON objects only, a BOM dropped', () => {
  assert.throws(() => parseBody('not json'), { kind: 'bad_response' });
  assert.throws(() => parseBody('[1,2]'), { kind: 'bad_response' });
  assert.throws(() => parseBody('{"message":"x"}'), { kind: 'bad_response' });
  assert.throws(() => parseBody('null'), { kind: 'bad_response' });
  assert.ok(parseBody(String.fromCharCode(0xfeff) + json(clouDuo())).controller);
});

test('numbers: finite numbers and numeric strings only', () => {
  assert.equal(toNumber('-48'), -48);
  assert.equal(toNumber(' 5.7 '), 5.7);
  assert.equal(toNumber('1e400'), undefined);
  assert.equal(toNumber('0x10'), undefined);
  assert.equal(toNumber(Infinity), undefined);
  assert.equal(toNumber(null), undefined);
  assert.equal(toNumber(true), undefined);
  assert.equal(toNumber({ valueOf: () => 1 }), undefined);
});

test('readInfo: the Clou Duo answer', () => {
  const info = read(clouDuo());
  assert.equal(info.status, 30);
  assert.equal(info.main.actual, 20.3);
  assert.equal(info.main.set, 21.5);
  assert.equal(info.combustion, 190);
  assert.deepEqual(info.power, { kw: 5.7, setPower: 5 });
  assert.equal(info.fuel.quantity, 0.95);
  assert.equal(info.rssi, -48);
  assert.equal(info.timeToService, 2160);
  assert.equal(info.variables.get(33), 1);
  assert.deepEqual(info.model, { model: 211, version: 15 });
});

test('readInfo: a broken answer gives undefined values, never a throw', () => {
  const info = readInfo({ controller: { temperatures: 'x', power: [1], statistic: null } });
  assert.equal(info.status, undefined);
  assert.equal(info.main, undefined);
  assert.equal(info.power.kw, undefined);
  assert.equal(info.fuel, undefined);
  const states = statesOf(info, 'fr');
  assert.deepEqual(states, []);
});

test('readInfo: own keys only', () => {
  const root = JSON.parse('{"controller":{"__proto__":{"status":30}}}');
  assert.equal(readInfo(root).status, undefined);
  const inherited = Object.create({ status: 30 });
  assert.equal(readInfo({ controller: inherited }).status, undefined);
});

test('the main temperature: on the main screen with a sensor, else the first one', () => {
  const answer = clouDuo();
  answer.controller.temperatures[0].onMainScreen = false;
  assert.equal(read(answer).main.id, 1, 'the first one');
  answer.controller.temperatures = [
    { id: 3, actual: 18, actualType: 1, onMainScreen: false },
    { id: 5, actual: 22, actualType: 1, onMainScreen: true },
  ];
  assert.equal(read(answer).main.id, 5);
});

test('states of the reference: every status code mapped, the "off" ones inactive', () => {
  for (const code of Object.keys(STATUS_STATE)) {
    assert.ok(STATUS_LABELS[code], `label of ${code}`);
  }
  assert.equal(stateOf(0), 'off');
  assert.equal(stateOf(21), 'ignition');
  assert.equal(stateOf(110), 'burning');
  assert.equal(stateOf(77), 'unknown');
  assert.equal(isActive(2), false);
  assert.equal(isActive(50), true);
  assert.equal(isActive(77), undefined);
  assert.equal(isActive(undefined), undefined);
  assert.equal(stateOf('__proto__'), 'unknown');
});

test('error and alert labels for every code the reference knows', () => {
  for (const code of ERROR_CODES) {
    assert.ok(ERROR_LABELS[code]?.fr && ERROR_LABELS[code]?.en, `E${code}`);
  }
  for (const code of ALERT_CODES) {
    assert.ok(ALERT_LABELS[code]?.fr && ALERT_LABELS[code]?.en, `A${code}`);
  }
  assert.equal(errorText(108, 'en'), 'E108: Safety switch I01 tripped (STB)');
  assert.equal(alertText(4, 'fr'), 'A004 : Pile faible');
  assert.equal(alertText(0, 'en'), 'No warning');
  assert.equal(errorText(undefined, 'en'), undefined);
});

test('the signal strength of the reference', () => {
  assert.equal(signalStrength(-100), 0);
  assert.equal(signalStrength(-120), 0);
  assert.equal(signalStrength(-75), 50);
  assert.equal(signalStrength(-40), 100);
});

test('states of the Clou Duo and of a plain stove', () => {
  assert.deepEqual(asMap(statesOf(read(clouDuo({ status: 40, door: 0, eco: 1 })), 'en')), {
    state: 'Eco',
    phase: 'Eco',
    active: 1,
    'room-temperature': 20.3,
    'target-temperature': 21.5,
    'combustion-temperature': 190,
    'power-level': 5,
    'fuel-level': 95,
    error: 0,
    'error-code': 'No error',
    warning: 0,
    'warning-code': 'No warning',
    'eco-mode': 1,
    'door-open': 1,
    'time-to-service': 2160,
    'burning-hours': 506.5,
    'igniter-starts': 392,
    misfires: 2,
    overheatings: 0,
    'wifi-signal': 100,
  });
  const plain = asMap(statesOf(read(simpleStove()), 'fr'));
  assert.equal(plain.state, 'Arrêt');
  assert.equal(plain['fuel-level'], undefined);
  assert.equal(plain['door-open'], undefined, 'var[33] is read on the Clou Duo only');
  assert.equal(plain['time-to-service'], undefined, '-1: no service counter');
});

test('heat output: kw while burning only, 0 when off, nothing in the other phases', () => {
  const heat = (status, kw) => asMap(statesOf(read(clouDuo({ status, kw })), 'en'))['heat-output'];
  // The reference fixtures: kw 7 while off.
  assert.equal(heat(0, 7), 0);
  assert.equal(heat(1, '7.0'), 0);
  assert.equal(heat(2, 7), 0);
  assert.equal(heat(30, '5.7'), 5.7);
  assert.equal(heat(110, 4), 4);
  for (const status of [10, 20, 21, 40, 50, 60, 80, 90, 100, 77]) {
    assert.equal(heat(status, 7), undefined, `status ${status}`);
  }
});

test('codes: integers from 0 to 999 only, shared by the answer and /data', () => {
  for (const bad of [-1, 1e6, 1000, '102', 'E102', 1.5, null, true, NaN]) {
    assert.equal(readCode(bad), undefined, String(bad));
    const info = read(clouDuo({ error: bad, alert: bad }));
    assert.equal(info.error, undefined);
    assert.equal(info.alert, undefined);
  }
  assert.equal(readCode(0), 0);
  assert.equal(readCode(999), 999);
  assert.equal(codeText('E', readCode(5)), 'E005');
});

test('an error envelope in a 200 is handled as its status', () => {
  const body = (code) => json({ message: 'x', code });
  assert.throws(() => parseBody(body(401)), { kind: 'refused', status: 401 });
  assert.throws(() => parseBody(body(404)), { kind: 'offline', status: 404 });
  assert.throws(() => parseBody(json({ statusCode: 404 })), { kind: 'offline' });
  assert.throws(() => parseBody(body(500)), { kind: 'bad_response' });
});

test('the last contact of the stove', () => {
  assert.equal(read(clouDuo()).unseenFor, 20);
  const old = clouDuo();
  old.controller.stoveLastAvailability = old.controller.currentTime - 2 * 86400;
  assert.equal(read(old).unseenFor, 2 * 86400);
  delete old.controller.stoveLastAvailability;
  assert.equal(read(old).unseenFor, undefined);
});

test('out-of-range values are not sent', () => {
  const states = asMap(
    statesOf(read(clouDuo({ room: 500, kw: '-3', quantity: 4, setPower: 99 })), 'en'),
  );
  for (const role of ['room-temperature', 'heat-output', 'fuel-level', 'power-level']) {
    assert.equal(states[role], undefined, role);
  }
});

test('ids: the scrypt of the MAC address, never the PIN, roles frozen', () => {
  const derived = scryptSync(MAC, 'gladys-fumis', 32, KEY_COST).toString('hex');
  assert.equal(stoveKey(MAC), derived.slice(0, 32));
  assert.equal(normalizeConfig({ mac_address: MAC, pin: PIN }).deviceId, derived.slice(0, 16));
  assert.equal(normalizeConfig({ mac_address: MAC, pin: 'other' }).key, stoveKey(MAC));
  assert.equal(KEY_COST.N, 2 ** 15);
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, {
    id: '0123456789abcdef',
    info: read(clouDuo()),
    language: 'fr',
  });
  assert.equal(device.external_id, 'ext:test-integration:fumis:0123456789abcdef');
  assert.equal(parseDeviceId(device.external_id), '0123456789abcdef');
  for (const feature of device.features) {
    assert.ok(parseFeatureId(feature.external_id), feature.external_id);
    assert.equal(feature.read_only, true);
  }
  assert.equal(parseFeatureId('ext:x:fumis:0123456789abcdef:__proto__'), undefined);
  assert.equal(parseDeviceId('ext:x:fumis:0016D0A1B2C3'), undefined);
  const frozen = JSON.parse(
    readFileSync(new URL('./fixtures/roles.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(ROLES), frozen, 'feature roles are published forever');
});

test('a device keeps the roles it was created with', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, {
    id: '0123456789abcdef',
    info: read(simpleStove()),
    language: 'fr',
    created: new Set(['fuel-level', 'door-open']),
  });
  const roles = device.features.map((f) => parseFeatureId(f.external_id).role);
  assert.ok(roles.includes('fuel-level') && roles.includes('door-open'));
});
