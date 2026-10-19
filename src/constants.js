// -----------------------------------------------------------------------------
// Constants of the Fumis WiRCU cloud API and of the integration.
//
// The API values come from frenck/python-fumis 0.4.2 (MIT, see
// THIRD_PARTY_NOTICES.md): the base URL `https://api.fumis.si/v1/`, the status
// endpoint, the MAC address and the PIN sent as the `username` and `password`
// headers. The API is not documented by Fumis: the reference learnt it by
// observing the traffic of its own stoves.
// -----------------------------------------------------------------------------

/** The manifest action keys. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The manifest scene trigger keys. */
export const SCENE_TRIGGERS = {
  ALARM: 'stove_alarm',
};

/** The WiRCU cloud API. */
export const API = {
  statusUrl: 'https://api.fumis.si/v1/status',
  /**
   * Our own name, as the reference sends its own ("PythonFumis"): never the
   * name or the User-Agent of a vendor app.
   */
  appName: 'gladys-fumis',
  userAgent: 'gladys-fumis (+https://github.com/LM1LC3N7/gladys-fumis)',
};

/** Gladys values (server/utils/constants.js of the core). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { default: 60, min: 60, max: 3600 };

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** A read of the cloud (the reference waits up to 60 s; 20 s here). */
  requestTimeout: 20_000,
  /** Two requests are never closer than this, whatever asks for them. */
  minRequestGap: 3_000,
  /** Pauses after failures, never shorter than the poll interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** After a refused MAC address or PIN: a new try after 10 min, 1 h, then every 6 h. */
  refusedRetry: [10 * MINUTE, HOUR, 6 * HOUR],
  /** 429: a pause between 60 s and 6 h, Retry-After when given. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** The test button and the Discovery scan read the cloud at most every 30 s. */
  testCooldown: 30_000,
  /** States flushed to Gladys every second; unchanged ones again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute. */
  statesPerMinute: 280,
  statesPerRequest: 100,
  sceneEventsPerMinute: 280,
  queuedEvents: 200,
  /** The biggest answer read: the reference's samples are 14 to 20 KB. */
  responseBytes: 256 * 1024,
  /** Entries read from each list of the answer (temperatures, fans, fuels…). */
  listItems: 32,
  /** Diagnostic variables read (the samples have 27 to 100). */
  variables: 512,
  /** A text state. */
  textLength: 160,
};
