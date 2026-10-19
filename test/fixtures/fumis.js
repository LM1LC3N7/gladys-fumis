// -----------------------------------------------------------------------------
// Answers shaped like the reference's fixtures (frenck/python-fumis 0.4.2,
// tests/fixtures: austroflamm_clou_duo*.json, info*.json), made-up values and
// cut to the fields this integration reads plus a few it ignores.
// -----------------------------------------------------------------------------

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** 2026-10-19 10:00:00 UTC. */
export const NOW = Date.UTC(2026, 9, 19, 10, 0, 0);

export const MAC = '0016D0A1B2C3';
export const MAC_TYPED = '00:16:d0:a1:b2:c3';
export const PIN = 'k7Q2x9Lm';
export const CONFIG = { mac_address: MAC_TYPED, pin: PIN, language: 'fr' };

const temperatureChannel = (
  id,
  { actual = 0, set = 0, actualType = 0, setType = 0, main = false },
) => ({
  name: null,
  weight: 0,
  setType,
  actualType,
  onMainScreen: main,
  actual,
  set,
  id,
});

/** An Austroflamm Clou Duo answer (the reference's main fixture), with overrides. */
export function clouDuo({
  status = 30,
  error = 0,
  alert = 0,
  room = 20.3,
  setpoint = 21.5,
  combustion = 190,
  kw = '5.7',
  setPower = 5,
  quantity = 0.95,
  door = 1,
  rssi = '-48',
  eco = 0,
  timeToService = '2160',
} = {}) {
  return {
    apiVersion: '1.3',
    unit: {
      id: MAC,
      type: 3,
      version: '2.5.0',
      command: null,
      rssi,
      ip: '192.168.1.2',
      timezone: null,
      temperature: 26.5,
    },
    controller: {
      type: 2,
      version: '2.6.0',
      command: 2,
      status,
      heatingSlope: '0.0',
      currentTime: 1760868000,
      error,
      alert,
      timerEnable: false,
      fuelType: 1,
      timeToService,
      delayedStartAt: -1,
      delayedStopAt: -1,
      power: { setType: 1, actualType: 2, kw, actualPower: setPower, setPower },
      ecoMode: { ecoModeSetType: 1, ecoModeEnable: eco },
      hybrid: null,
      antifreeze: { temperature: null, enable: null },
      statistic: {
        igniterStarts: 392,
        uptime: '58184580',
        heatingTime: '1823400',
        serviceTime: '1823400',
        overheatings: 0,
        misfires: 2,
        fuelQuantityUsed: 0,
      },
      fans: [{ weight: 0, speedType: 6, speed: 1, id: 1 }],
      fuels: [
        {
          name: null,
          quality: 2,
          qualityType: 0,
          qualityActual: null,
          quantitySetType: 2,
          quantityActualType: 2,
          quantity,
          quantityDisplay: 1,
          id: 1,
        },
      ],
      temperatures: [
        temperatureChannel(1, {
          actual: room,
          set: setpoint,
          actualType: 1,
          setType: 2,
          main: true,
        }),
        temperatureChannel(2, {}),
        temperatureChannel(7, { actual: combustion, actualType: 10 }),
        temperatureChannel(8, { set: 0.5, actualType: 1, setType: 1 }),
      ],
      diagnostic: {
        variables: [
          { id: 4, value: 0 },
          { id: 11, value: 92 },
          { id: 33, value: door },
          { id: 35, value: 700 },
          { id: 96, value: 211 },
          { id: 97, value: 15 },
        ],
        parameters: [{ id: 0, value: 1 }],
        timers: [],
      },
      timers: [],
    },
  };
}

/** A plain pellet stove (the reference's info.json): no fuel level, no combustion channel. */
export function simpleStove() {
  const answer = clouDuo({ status: 0 });
  answer.controller.fuels[0].quantity = 0;
  answer.controller.fuels[0].quantityActualType = 0;
  answer.controller.fuels[0].quantityDisplay = null;
  answer.controller.temperatures = answer.controller.temperatures.filter((t) => t.id !== 7);
  answer.controller.diagnostic.variables = [
    { id: 33, value: 1 },
    { id: 96, value: 2 },
    { id: 97, value: 10 },
  ];
  answer.controller.ecoMode = { ecoModeSetType: null, ecoModeEnable: null };
  answer.controller.timeToService = '-1';
  return answer;
}

export const json = (document) => JSON.stringify(document);
