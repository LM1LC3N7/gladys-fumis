// -----------------------------------------------------------------------------
// The stove -> one Gladys device, and its states (pure).
//
// One Gladys device per stove, `ext:<selector>:fumis:<id>` with `<id>` the
// first 16 hexadecimal digits of a scrypt of the MAC address (src/config.js):
// stable for the WiRCU module, and the MAC address itself (half of the
// credential) never reaches Gladys. The features are keyed by their role (the
// last part of their external id): those keys are published forever, never
// rename them. A device already created keeps all its features when it is
// published again.
//
// Read only (v1): every feature is `read_only`, no switch, no thermostat, no
// setpoint, nothing a voice assistant, an "all off" or a scene could change.
// The setpoint is a `temperature-sensor/probe`. Units are only those the core
// lists for the category (DEVICE_FEATURE_UNITS_BY_CATEGORY): kW and % have no
// category that lists them for these values, so they have no unit and say it
// in their name. The thermal output is no energy-sensor feature (the core
// would count it as electricity).
//
// Ported in part from frenck/python-fumis 0.4.2 (MIT), changed (the values
// kept, the conditions of presence): see THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS, LIMITS } from './constants.js';
import { BURNING, OFF, codeText, isActive, modelOf, stateOf } from './fumis.js';
import {
  ALERT_LABELS,
  DEVICE_NAME,
  ERROR_LABELS,
  MESSAGES,
  STATE_LABELS,
  STATUS_LABELS,
  both,
  word,
} from './i18n.js';

// --- Feature shapes ----------------------------------------------------------

const temperature = (type, min, max) => ({
  category: C.TEMPERATURE_SENSOR,
  type,
  unit: U.CELSIUS,
  min,
  max,
});
const text = { category: C.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0, keep_history: false };
const binary = { category: C.UNKNOWN, type: TYPES.SENSOR.BINARY, min: 0, max: 1 };
const decimal = (min, max) => ({ category: C.UNKNOWN, type: TYPES.SENSOR.DECIMAL, min, max });
const integer = (min, max) => ({ category: C.UNKNOWN, type: TYPES.SENSOR.INTEGER, min, max });
const hours = (min, max) => ({
  category: C.DURATION,
  type: TYPES.DURATION.DECIMAL,
  unit: U.HOURS,
  min,
  max,
});

/** A number within [min, max], rounded; undefined otherwise. */
const within = (value, min, max, decimals = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return undefined;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const state = (value) => (value === undefined ? undefined : { state: value });
const flag = (value) =>
  value === undefined ? undefined : { state: value ? GLADYS.ON : GLADYS.OFF };

/** The reference's signal strength: -100 dBm or less = 0 %, -50 dBm or more = 100 %. */
export const signalStrength = (rssi) =>
  rssi === undefined ? undefined : Math.max(0, Math.min(100, 2 * (rssi + 100)));

const statusText = (status, language) => {
  if (status === undefined) {
    return undefined;
  }
  const label = Object.hasOwn(STATUS_LABELS, status)
    ? STATUS_LABELS[status]
    : MESSAGES.unknownStatus(status);
  return word(label, language);
};

/** "E102 : Cheminée ou creuset encrassé…", or "Aucune erreur". */
export function errorText(code, language) {
  if (code === undefined) {
    return undefined;
  }
  if (code === 0) {
    return word(MESSAGES.noError, language);
  }
  const label = Object.hasOwn(ERROR_LABELS, code) ? ERROR_LABELS[code] : MESSAGES.unknownError;
  return `${codeText('E', code)}${language === 'fr' ? ' : ' : ': '}${word(label, language)}`;
}

/** "A001 : Niveau de granulés bas", or "Aucun avertissement". */
export function alertText(code, language) {
  if (code === undefined) {
    return undefined;
  }
  if (code === 0) {
    return word(MESSAGES.noAlert, language);
  }
  const label = Object.hasOwn(ALERT_LABELS, code) ? ALERT_LABELS[code] : MESSAGES.unknownAlert;
  return `${codeText('A', code)}${language === 'fr' ? ' : ' : ': '}${word(label, language)}`;
}

/**
 * The roles of the stove: `present(info)` says whether the answer has the
 * value (a feature appears then, even when its value is out of range),
 * `value(info, language)` gives `{ state }`, `{ text }` or undefined.
 */
export const ROLES = {
  state: {
    feature: text,
    present: (i) => i.status !== undefined,
    value: (i, language) =>
      i.status === undefined
        ? undefined
        : { text: word(STATE_LABELS[stateOf(i.status)], language) },
  },
  phase: {
    feature: text,
    present: (i) => i.status !== undefined,
    value: (i, language) => {
      const label = statusText(i.status, language);
      return label === undefined ? undefined : { text: label };
    },
  },
  active: {
    feature: binary,
    present: (i) => i.status !== undefined,
    value: (i) => flag(isActive(i.status)),
  },
  'room-temperature': {
    // The ambient sensor of the stove: `decimal`, as a room temperature (the core's type).
    feature: temperature(TYPES.SENSOR.DECIMAL, -30, 80),
    present: (i) => i.main !== undefined,
    value: (i) => state(within(i.main?.actual, -30, 80)),
  },
  'target-temperature': {
    feature: temperature(TYPES.TEMPERATURE_SENSOR.PROBE, 0, 100),
    present: (i) => i.main !== undefined && i.main.setType > 0,
    value: (i) => (i.main?.setType > 0 ? state(within(i.main.set, 0, 100)) : undefined),
  },
  'combustion-temperature': {
    feature: temperature(TYPES.TEMPERATURE_SENSOR.PROBE, -20, 1500),
    present: (i) => i.combustion !== undefined,
    value: (i) => state(within(i.combustion, -20, 1500)),
  },
  'power-level': {
    feature: integer(0, 10),
    present: (i) => i.power.setPower !== undefined,
    value: (i) => state(within(i.power.setPower, 0, 10, 0)),
  },
  // `kw` may keep the nominal power while the stove is off (the reference
  // fixtures show 7 kW off) and lags behind in the other phases: its value
  // only while burning, 0 when off, nothing in between.
  'heat-output': {
    feature: decimal(0, 100),
    present: (i) => i.power.kw !== undefined,
    value: (i) => {
      if (OFF.has(i.status)) {
        return state(0);
      }
      return BURNING.has(i.status) ? state(within(i.power.kw, 0, 100, 2)) : undefined;
    },
  },
  'fuel-level': {
    feature: decimal(0, 100),
    // A stove that does not measure its fuel sends 0 with a type 0 and no display mode.
    present: (i) =>
      i.fuel?.quantity !== undefined && (i.fuel.actualType > 0 || i.fuel.display !== undefined),
    value: (i) =>
      i.fuel?.quantity === undefined ? undefined : state(within(i.fuel.quantity * 100, 0, 100)),
  },
  error: {
    feature: binary,
    present: (i) => i.error !== undefined,
    value: (i) => (i.error === undefined ? undefined : flag(i.error !== 0)),
  },
  'error-code': {
    feature: text,
    present: (i) => i.error !== undefined,
    value: (i, language) => {
      const label = errorText(i.error, language);
      return label === undefined ? undefined : { text: label };
    },
  },
  warning: {
    feature: binary,
    present: (i) => i.alert !== undefined,
    value: (i) => (i.alert === undefined ? undefined : flag(i.alert !== 0)),
  },
  'warning-code': {
    feature: text,
    present: (i) => i.alert !== undefined,
    value: (i, language) => {
      const label = alertText(i.alert, language);
      return label === undefined ? undefined : { text: label };
    },
  },
  'eco-mode': {
    feature: binary,
    present: (i) => i.eco === 0 || i.eco === 1,
    value: (i) => (i.eco === 0 || i.eco === 1 ? flag(i.eco === 1) : undefined),
  },
  // var[33]: the combustion door, confirmed on the Austroflamm Clou Duo only
  // (0 = open): shown for that model only.
  'door-open': {
    feature: binary,
    present: (i) => i.variables.has(33) && modelOf(i.model) !== undefined,
    value: (i) =>
      i.variables.has(33) && modelOf(i.model) !== undefined
        ? flag(i.variables.get(33) === 0)
        : undefined,
  },
  'time-to-service': {
    feature: hours(-100_000, 100_000),
    present: (i) => i.timeToService !== undefined,
    value: (i) => state(within(i.timeToService, -100_000, 100_000, 0)),
  },
  'burning-hours': {
    feature: hours(0, 1_000_000),
    present: (i) => i.stats.heatingTime !== undefined,
    value: (i) =>
      i.stats.heatingTime === undefined
        ? undefined
        : state(within(i.stats.heatingTime / 3600, 0, 1_000_000)),
  },
  'igniter-starts': {
    feature: integer(0, 100_000_000),
    present: (i) => i.stats.igniterStarts !== undefined,
    value: (i) => state(within(i.stats.igniterStarts, 0, 100_000_000, 0)),
  },
  misfires: {
    feature: integer(0, 100_000_000),
    present: (i) => i.stats.misfires !== undefined,
    value: (i) => state(within(i.stats.misfires, 0, 100_000_000, 0)),
  },
  overheatings: {
    feature: integer(0, 100_000_000),
    present: (i) => i.stats.overheatings !== undefined,
    value: (i) => state(within(i.stats.overheatings, 0, 100_000_000, 0)),
  },
  'wifi-signal': {
    feature: integer(0, 100),
    present: (i) => i.rssi !== undefined,
    value: (i) => state(signalStrength(i.rssi)),
  },
};

/** Feature names, by role, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  state: both('State', 'État'),
  phase: both('Phase', 'Phase'),
  active: both('Operating', 'En fonctionnement'),
  'room-temperature': both('Room temperature', 'Température ambiante'),
  'target-temperature': both('Target temperature', 'Consigne'),
  'combustion-temperature': both('Combustion chamber temperature', 'Température du foyer'),
  'power-level': both('Power level (set)', 'Niveau de puissance (réglé)'),
  'heat-output': both('Heat output (kW)', 'Puissance thermique (kW)'),
  'fuel-level': both('Pellet level (%)', 'Niveau de granulés (%)'),
  error: both('Error', 'Erreur'),
  'error-code': both('Error code', 'Code d’erreur'),
  warning: both('Warning', 'Avertissement'),
  'warning-code': both('Warning code', 'Code d’avertissement'),
  'eco-mode': both('Eco mode', 'Mode éco'),
  'door-open': both('Door open', 'Porte ouverte'),
  'time-to-service': both('Time to service', 'Temps avant entretien'),
  'burning-hours': both('Burning time', 'Durée de combustion'),
  'igniter-starts': both('Igniter starts', 'Allumages'),
  misfires: both('Misfires', 'Allumages ratés'),
  overheatings: both('Overheatings', 'Surchauffes'),
  'wifi-signal': both('Wi-Fi signal (%)', 'Signal Wi-Fi (%)'),
};

// --- Ids ---------------------------------------------------------------------

export const deviceIds = (gladys, id) => gladys.externalIds('fumis', String(id));

/** The stove id and the role of a feature external id. */
export function parseFeatureId(externalId) {
  const match = /:fumis:([0-9a-f]{16}):([a-z0-9-]+)$/.exec(String(externalId ?? ''));
  return match && Object.hasOwn(ROLES, match[2]) ? { id: match[1], role: match[2] } : undefined;
}

/** The stove id of a device external id. */
export function parseDeviceId(externalId) {
  return /:fumis:([0-9a-f]{16})$/.exec(String(externalId ?? ''))?.[1];
}

// --- Device ------------------------------------------------------------------

/** "Poêle Fumis", or "Poêle Austroflamm Clou Duo" for a known model. */
export function deviceName(info, language) {
  const model = info ? modelOf(info.model) : undefined;
  if (!model) {
    return word(DEVICE_NAME, language);
  }
  const name = `${model.manufacturer} ${model.model}`.slice(0, LIMITS.textLength);
  return language === 'fr' ? `Poêle ${name}` : `${name} stove`;
}

/**
 * The roles of the stove: those the answer has, plus those of the device
 * already created in Gladys (`created`: its role set), so a republished
 * device never loses a feature.
 */
export function rolesOf(info, created = new Set()) {
  return Object.keys(ROLES).filter(
    (role) => (info !== undefined && ROLES[role].present(info)) || created.has(role),
  );
}

/** The Gladys device of the stove. `created`: the roles of the device already in Gladys. */
export function buildDevice(gladys, { id, info, name, language, created }) {
  const ids = deviceIds(gladys, id);
  return {
    name: name ?? deviceName(info, language),
    external_id: ids.device,
    features: rolesOf(info, created).map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...ROLES[role].feature,
    })),
    params: [],
  };
}

/** The Gladys states of the stove: `[{ role, state }]` or `[{ role, text }]`. */
export function statesOf(info, language, roles = rolesOf(info)) {
  const states = [];
  for (const role of roles) {
    const value = ROLES[role].value(info, language);
    if (value !== undefined) {
      states.push({ role, ...value });
    }
  }
  return states;
}
