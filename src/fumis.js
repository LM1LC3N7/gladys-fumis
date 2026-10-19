// -----------------------------------------------------------------------------
// The answer of `GET /v1/status`, read as untrusted data (pure).
//
// The body is parsed once (JSON.parse, bounded by the size read), then only
// own keys of the expected shapes are read (`Object.hasOwn`): nothing is
// merged into an object, so a `__proto__` key changes nothing. Lists are cut
// to a few entries, numbers accepted only when finite (the API sends some as
// strings: `rssi`, `kw`, `timeToService`), every pass is linear.
//
// The meaning of the fields, the status codes and the error and alert codes
// are ported from frenck/python-fumis 0.4.2 (MIT, `const.py` and `models.py`),
// changed: see THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { FumisError } from './http.js';

/** An own key of a plain object, else undefined. */
export function field(object, key) {
  if (object === null || typeof object !== 'object' || Array.isArray(object)) {
    return undefined;
  }
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

const NUMERIC = /^[-+]?\d{1,12}(?:\.\d{1,6})?$/;

/** A finite number, from a number or a numeric string; undefined otherwise. */
export function toNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    return NUMERIC.test(text) ? Number(text) : undefined;
  }
  return undefined;
}

/** An integer, from a number or a numeric string; undefined otherwise. */
export function toInteger(raw) {
  const value = toNumber(raw);
  return Number.isInteger(value) ? value : undefined;
}

/** The first entries of a list of objects (an absent or broken list is empty). */
const list = (raw, max = LIMITS.listItems) =>
  Array.isArray(raw)
    ? raw.slice(0, max).filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
    : [];

/** The body -> the root object, or a FumisError. */
export function parseBody(body) {
  const text = typeof body === 'string' ? body : Buffer.from(body ?? []).toString('utf8');
  let root;
  try {
    root = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new FumisError('bad_response', 'the answer is not JSON');
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new FumisError('bad_response', 'the answer is not a JSON object');
  }
  if (field(root, 'controller') === undefined && field(root, 'unit') === undefined) {
    throw new FumisError('bad_response', 'the answer has no controller');
  }
  return root;
}

/** One temperature channel: `{ id, actual, set, onMainScreen, actualType, setType }`. */
function temperature(entry) {
  return {
    id: toInteger(field(entry, 'id')),
    actual: toNumber(field(entry, 'actual')),
    set: toNumber(field(entry, 'set')),
    onMainScreen: field(entry, 'onMainScreen') === true,
    actualType: toInteger(field(entry, 'actualType')) ?? 0,
    setType: toInteger(field(entry, 'setType')) ?? 0,
  };
}

/** The diagnostic variables: id -> value (the first of each id wins). */
function variables(diagnostic) {
  const map = new Map();
  for (const entry of list(field(diagnostic, 'variables'), LIMITS.variables)) {
    const id = toInteger(field(entry, 'id'));
    const value = toInteger(field(entry, 'value'));
    if (id !== undefined && value !== undefined && !map.has(id)) {
      map.set(id, value);
    }
  }
  return map;
}

/**
 * The values this integration reads, from the root of an answer; every
 * value may be undefined (absent, not a number).
 */
export function readInfo(root) {
  const unit = field(root, 'unit');
  const controller = field(root, 'controller');
  const temperatures = list(field(controller, 'temperatures')).map(temperature);
  // The reference's `main_temperature`: the channel on the main screen with a
  // sensor, else the first one.
  const main =
    temperatures.find((t) => t.onMainScreen && t.actualType > 0) ?? temperatures[0] ?? undefined;
  const combustion = temperatures.find((t) => t.id === 7 && t.actualType > 0);
  const power = field(controller, 'power');
  const fuel = list(field(controller, 'fuels')).find((f) => toInteger(field(f, 'id')) === 1);
  const eco = field(controller, 'ecoMode');
  const statistic = field(controller, 'statistic');
  const vars = variables(field(controller, 'diagnostic'));
  const timeToService = toInteger(field(controller, 'timeToService'));
  return {
    status: toInteger(field(controller, 'status')),
    error: toInteger(field(controller, 'error')),
    alert: toInteger(field(controller, 'alert')),
    main,
    combustion: combustion?.actual,
    power: {
      kw: toNumber(field(power, 'kw')),
      setPower: toInteger(field(power, 'setPower')),
    },
    fuel: fuel
      ? {
          quantity: toNumber(field(fuel, 'quantity')),
          actualType: toInteger(field(fuel, 'quantityActualType')) ?? 0,
          display: toInteger(field(fuel, 'quantityDisplay')),
        }
      : undefined,
    eco: toInteger(field(eco, 'ecoModeEnable')),
    // -1: no service counter.
    timeToService: timeToService === -1 ? undefined : timeToService,
    stats: {
      igniterStarts: toInteger(field(statistic, 'igniterStarts')),
      heatingTime: toInteger(field(statistic, 'heatingTime')),
      misfires: toInteger(field(statistic, 'misfires')),
      overheatings: toInteger(field(statistic, 'overheatings')),
    },
    rssi: toInteger(field(unit, 'rssi')),
    variables: vars,
    model: { model: vars.get(96), version: vars.get(97) },
  };
}

// --- Codes (reference const.py) -----------------------------------------------

/** controller.status -> the simplified state of the reference (StoveState). */
export const STATUS_STATE = {
  0: 'off',
  1: 'off',
  2: 'off',
  10: 'heating_up',
  20: 'ignition',
  21: 'ignition',
  30: 'burning',
  40: 'eco',
  50: 'cooling',
  60: 'heating_up',
  80: 'ignition',
  90: 'ignition',
  100: 'heating_up',
  110: 'burning',
};

/** The state of a status code ('unknown' for a code the reference does not know). */
export const stateOf = (status) =>
  status !== undefined && Object.hasOwn(STATUS_STATE, status) ? STATUS_STATE[status] : 'unknown';

/** The stove is operating: any known status but the "off" ones (reference `on`). */
export const isActive = (status) => {
  const state = stateOf(status);
  return state === 'unknown' ? undefined : state !== 'off';
};

/** Error codes known by the reference (controller.error, shown as E101…). */
export const ERROR_CODES = [
  101, 102, 105, 106, 107, 108, 109, 110, 111, 113, 114, 115, 239, 240, 241, 243, 244, 245, 247,
  248, 249, 250, 252, 253,
];

/** Alert codes known by the reference (controller.alert, shown as A001…). */
export const ALERT_CODES = [1, 2, 3, 4, 5, 6, 7];

/** "E102", "A004": the code as the stove display shows it. */
export const codeText = (prefix, code) => `${prefix}${String(code).padStart(3, '0')}`;

/** Known stove models (reference STOVE_MODELS): `${var96}:${var97}` -> name. */
export const STOVE_MODELS = {
  '211:15': { manufacturer: 'Austroflamm', model: 'Clou Duo' },
};

export function modelOf({ model, version }) {
  const key = `${model}:${version}`;
  return model === undefined || version === undefined || !Object.hasOwn(STOVE_MODELS, key)
    ? undefined
    : STOVE_MODELS[key];
}
