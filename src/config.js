// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// The stove is reached through the WiRCU cloud with the MAC address and the
// PIN printed on the WiRCU module: together they are the whole credential.
// The PIN is a `secret` field; neither the PIN nor the MAC address is ever
// logged, shown in a status, written to /data or published to Gladys (the
// device and the /data file are keyed by a hash of the MAC address).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/**
 * The MAC address typed by the user, as the API wants it: 12 hexadecimal
 * digits, upper case, without separators ("00:16:D0:AA:BB:CC" and
 * "00-16-d0-aa-bb-cc" are accepted). `{ mac }`, `{ error: 'invalid' }`, or
 * `{}` when empty.
 */
export function parseMac(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (text.length > 32) {
    return { error: 'invalid' };
  }
  const mac = text.replace(/[\s:.-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(mac) ? { mac } : { error: 'invalid' };
}

/**
 * The PIN typed by the user: printable ASCII without spaces, 64 characters at
 * most (it is sent as an HTTP header: no control character may reach it).
 * `{ pin }`, `{ error: 'invalid' }`, or `{}` when empty.
 */
export function parsePin(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return {};
  }
  return /^[\x21-\x7e]{1,64}$/.test(text) ? { pin: text } : { error: 'invalid' };
}

/**
 * The key of a stove: a hash of its MAC address, never the PIN (a short PIN
 * is easy to find back from its hash). It keys /data, and its first 16 digits
 * the Gladys device, so the MAC address itself never reaches Gladys.
 */
export const stoveKey = (mac) =>
  mac ? createHash('sha256').update(`fumis:${mac}`, 'utf8').digest('hex').slice(0, 32) : '';

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}) {
  const mac = parseMac(raw?.mac_address);
  const pin = parsePin(raw?.pin);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const key = stoveKey(mac.mac);
  return {
    mac: mac.mac ?? '',
    macError: mac.error,
    pin: pin.pin ?? '',
    pinError: pin.error,
    key,
    deviceId: key.slice(0, 16),
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
