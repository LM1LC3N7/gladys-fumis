// -----------------------------------------------------------------------------
// The integration: the MAC address and the PIN of the WiRCU module, one read
// of the Fumis cloud per cycle (60 s by default), the Gladys device and its
// states, the "stove alarm" scene trigger, the transport badges.
//
// Read only (v1): a flame appliance is never lit, stopped nor set from here;
// every command Gladys could send is refused, and the client has no write
// method at all.
//
// Careful reads: one request at a time, never two closer than 3 s (src/
// client.js), never faster than the interval after a failure; a refused MAC
// address or PIN stops the reads (new try after 10 min, 1 h, then every 6 h,
// or at once on new settings or the test button); a 429 pauses every path for
// 60 s to 6 h; other errors (the stove offline included) back off. The pause,
// the stop and the codes already seen are kept in /data and bounded. The test
// button and Discovery read only max(30 s, interval) after the last attempt.
// A reconnection to Gladys resends what Gladys keeps in memory only (status,
// Discovery list, badges) and keeps the pause, the stop and the client.
// index.js only wires the SDK handlers to this class.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { FumisClient } from './client.js';
import { normalizeConfig } from './config.js';
import { SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  alertText,
  buildDevice,
  deviceIds,
  errorText,
  parseDeviceId,
  parseFeatureId,
  statesOf,
} from './devices.js';
import { STALE_AFTER, codeText, readInfo } from './fumis.js';
import { FumisError, errorReason } from './http.js';
import { T, age, both, join, reasonOf, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors after which the stove (or the cloud) did not answer at all. */
const OFFLINE = new Set(['network', 'timeout', 'offline', 'stale']);

/** Errors of this stove only: their backoff is dropped when the MAC address changes. */
const STOVE_ONLY = new Set(['offline', 'stale']);

/** Devices of another stove (an earlier MAC address) kept in the Discovery list, at most. */
const OTHER_STOVES = 5;

export class FumisApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'fumis' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new FumisClient({ transport, now, timers });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** The values of the last answer (src/fumis.js readInfo). */
    this.info = undefined;
    this.readAt = undefined;
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.badges = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    /** The MAC address or the PIN was refused: no read until `retryAt`. */
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    /**
     * 'rate' (429) or 'backoff' (failures): no read before `pausedUntil`, by
     * any path; both kept in /data.
     */
    this.pauseKind = undefined;
    /** The pause comes from the cloud itself (429, 5xx, network), not from this stove. */
    this.pauseCloud = false;
    /** The codes last seen: `{ error, alert }` (kept in /data); undefined before the first read. */
    this.alarmSeen = undefined;
    this.alarmsChanged = false;
    this.lastStatus = undefined;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user changed the MAC address or the PIN, the stop is lifted. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (this.memory.key !== this.config.key) {
      // Another stove: the stop and the codes of the previous one are not its
      // own; a pause of the cloud itself (429, 5xx, network) still holds.
      const pause = this.memory.pause?.cloud ? this.memory.pause : null;
      this.memory = { key: this.config.key, pause, block: null, alarms: null };
    }
    if (fresh) {
      this.memory.block = null;
    }
    const { pause, block, alarms } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
      this.pauseCloud = pause.cloud;
      this.failures = pause.failures;
    }
    if (block) {
      this.blocked = true;
      this.retries = block.retries;
      this.retryAt = block.retryAt;
    }
    if (alarms) {
      this.alarmSeen = { ...alarms };
    }
    this.client.configure(this.config);
    await this.saveMemory();
    this.publisher.start();
    const missing = this.configMessage();
    if (missing) {
      await this.setStatus(false, missing);
      return;
    }
    if (this.blocked) {
      await this.setStatus(false, T.refused(age(this.retryAt - this.now())));
      this.scheduleNext();
      return;
    }
    if (this.now() < this.pausedUntil) {
      // A pause kept across the restart: the first read waits for its end.
      await this.setStatus(
        false,
        this.pauseMessage() ?? T.waiting(age(this.pausedUntil - this.now())),
      );
      this.scheduleAt(this.pausedUntil);
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** What the configuration lacks, as a status message; undefined when complete. */
  configMessage() {
    if (this.config.macError) {
      return T.macInvalid;
    }
    if (this.config.pinError) {
      return T.pinInvalid;
    }
    return this.client.configured ? undefined : T.noConfig;
  }

  get configured() {
    return this.configMessage() === undefined;
  }

  /** A 429 pause holds now (every path waits). */
  get ratePaused() {
    return this.pauseKind === 'rate' && this.now() < this.pausedUntil;
  }

  /** Forgets the last answer and the failures: a new stove, or a restart. */
  reset() {
    this.info = undefined;
    this.readAt = undefined;
    this.published = undefined;
    this.badges.clear();
    this.alarmSeen = undefined;
    this.alarmsChanged = false;
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    this.pauseCloud = false;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges). The pause, the stop and the client stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** A new MAC address or PIN restarts (and lifts the stop); the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.mac !== previous.mac ||
      next.pin !== previous.pin ||
      next.macError !== previous.macError ||
      next.pinError !== previous.pinError
    ) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
      this.queueAll();
      await this.flush();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  /** Writes /data; true when the write succeeded. */
  async saveMemory() {
    try {
      await this.store.save(this.memory);
      return true;
    } catch (err) {
      this.logger.warn(`Saving the state to /data failed: ${err.message}`);
      return false;
    }
  }

  /**
   * The pause, the stop and the codes seen, with the stove they belong to.
   * The codes stay "changed" until a write succeeds: the next read writes
   * them again, so a restart never fires an alarm already sent.
   */
  async persist() {
    this.memory.key = this.config.key;
    this.memory.pause =
      this.pauseKind && this.now() < this.pausedUntil
        ? {
            kind: this.pauseKind,
            until: this.pausedUntil,
            failures: this.failures,
            cloud: this.pauseCloud,
          }
        : null;
    this.memory.block = this.blocked ? { retries: this.retries, retryAt: this.retryAt } : null;
    this.memory.alarms = this.alarmSeen ? { ...this.alarmSeen } : null;
    if (await this.saveMemory()) {
      this.alarmsChanged = false;
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The next read: after the pause or the stop, else the interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.configured) {
      return;
    }
    const now = this.now();
    const interval = this.config.pollInterval * 1000;
    let delay;
    if (this.blocked) {
      // Never closer than one interval to the last attempt.
      delay = Math.max(this.retryAt, this.pausedUntil, this.client.lastRequestAt + interval) - now;
    } else if (now < this.pausedUntil) {
      // Never read again faster than the interval, a pause included.
      delay = Math.max(this.pausedUntil - now, interval);
    } else {
      delay = interval;
    }
    this.scheduleAt(now + delay);
  }

  /** The next read at `at` (at once when it is past). */
  scheduleAt(at) {
    this.clearTimer();
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Fumis refresh failed: ${err.message}`));
        }
      },
      Math.max(0, at - this.now()),
    );
  }

  /**
   * One run at a time: a tick during a run joins it. `force`: the test
   * button retrying refused credentials before their scheduled new try.
   */
  tick({ force = false } = {}) {
    if (!this.running) {
      this.running = this.run({ force }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ force = false } = {}) {
    const generation = this.generation;
    if (!this.configured) {
      return;
    }
    // A stop is only lifted by a successful read: while it is tried again,
    // `blocked` stays set (and in /data).
    const retryDue = this.blocked && (force || this.now() >= this.retryAt);
    if ((this.blocked && !retryDue) || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    if (retryDue) {
      this.logger.info('Fumis: trying again after refused credentials');
    }
    try {
      const root = await this.client.read();
      if (generation !== this.generation) {
        return;
      }
      const info = readInfo(root);
      if (info.unseenFor !== undefined && info.unseenFor > STALE_AFTER) {
        // The cloud answers with the last values it got: the stove is offline.
        // Neither the states nor the codes seen are touched.
        const err = new FumisError('stale', 'the cloud has not seen the stove for a while');
        err.unseenFor = info.unseenFor * 1000;
        throw err;
      }
      this.ingest(info);
      this.readAt = this.now();
      await this.publishDevices();
      const hadStop = this.blocked || this.retries > 0 || this.pauseKind !== undefined;
      this.blocked = false;
      this.failures = 0;
      this.retries = 0;
      this.retryAt = 0;
      this.offline = false;
      if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
        this.pauseKind = undefined;
        this.pausedUntil = 0;
        this.pauseCloud = false;
      }
      if (hadStop || this.alarmsChanged || this.memory.block || this.memory.pause) {
        await this.persist();
      }
      await this.setStatus(true, T.connected);
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /** A failure: a stop, a pause, or a backoff. Never a dead integration. */
  async failed(err) {
    const reason = errorReason(err);
    if (err?.kind === 'no_config') {
      await this.setStatus(false, T.noConfig);
      return;
    }
    if (err?.kind === 'refused') {
      const wait = TIMINGS.refusedRetry[Math.min(this.retries, TIMINGS.refusedRetry.length - 1)];
      this.retries += 1;
      this.blocked = true;
      this.offline = true;
      this.retryAt = this.now() + wait;
      this.logger.warn(`Fumis: ${reason}; one new try in ${Math.round(wait / 60_000)} min`);
      await this.persist();
      await this.setStatus(false, T.refused(age(wait)));
      return;
    }
    let wait;
    let message;
    if (err?.kind === 'rate_limited') {
      wait = this.pause(err);
      message = T.rateLimited(age(wait));
    } else {
      // Never read again faster than the poll interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      if (!this.ratePaused) {
        this.pauseKind = 'backoff';
        this.pauseCloud = !STOVE_ONLY.has(err?.kind);
      }
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.offline = OFFLINE.has(err?.kind) || this.offline;
      if (err?.kind === 'offline') {
        message = T.offline(age(wait));
      } else if (err?.kind === 'stale') {
        message = T.stale(age(err.unseenFor), age(wait));
      } else {
        message = T.unreachable(reasonOf(err), age(wait));
      }
    }
    this.failures += 1;
    await this.persist();
    const connected = err?.kind === 'rate_limited' && this.readAt !== undefined;
    await this.setStatus(connected, message);
    this.logger.warn(`Fumis: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** 429: a pause of Retry-After, between 60 s and 6 h, for every path (kept in /data). */
  pause(err) {
    const asked = err.retryAfter ?? TIMINGS.rateLimitDefault;
    const wait = Math.max(TIMINGS.rateLimitMin, Math.min(TIMINGS.rateLimitMax, asked));
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseKind = 'rate';
    this.pauseCloud = true;
    return wait;
  }

  /** One answer: kept, the scene events of the new codes, the states queued. */
  ingest(info) {
    this.info = info;
    this.alarmEvents(info);
    this.queueAll();
  }

  /**
   * The "stove alarm" scene events: an error or an alert code that differs
   * from the one last seen and is not 0 fires once (the same code fires
   * again only after it cleared). The codes last seen are kept in /data, so
   * a restart never fires again an alarm still shown; without memory (or
   * with an invalid one) a code is only learnt. A code the answer lacks, or
   * that readCode refused (not 0 to 999), keeps the one known and fires
   * nothing.
   */
  alarmEvents(info) {
    const language = this.config.language;
    const learning = !this.alarmSeen;
    this.alarmSeen ??= {};
    const events = [];
    const kinds = [
      ['error', 'E', errorText],
      ['alert', 'A', alertText],
    ];
    for (const [name, prefix, text] of kinds) {
      const code = info[name];
      const known = this.alarmSeen[name];
      if (code === undefined || code === known) {
        continue;
      }
      // Never seen before (first read, or the field was absent): only learnt.
      if (!learning && known !== undefined && code !== 0) {
        events.push({
          message: text(code, language),
          code: codeText(prefix, code),
          kind: name === 'error' ? 'error' : 'warning',
        });
      }
      this.alarmSeen[name] = code;
      this.alarmsChanged = true;
    }
    if (learning) {
      this.alarmsChanged = true;
    }
    for (const data of events) {
      this.publisher.pushSceneEvent(SCENE_TRIGGERS.ALARM, data);
      this.logger.warn(`Fumis: new stove ${data.kind} (${data.code})`);
    }
  }

  // --- Gladys ----------------------------------------------------------------

  /** The devices of this integration already created in Gladys. */
  createdDevices() {
    return (this.gladys.devices ?? []).filter((d) => parseDeviceId(d.external_id) !== undefined);
  }

  /** The roles of a device already created in Gladys. */
  createdRoles(device) {
    return new Set(
      (device?.features ?? [])
        .map((f) => parseFeatureId(f.external_id)?.role)
        .filter((role) => role !== undefined),
    );
  }

  createdDevice(id) {
    const externalId = deviceIds(this.gladys, id).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /**
   * The devices to publish: the stove read, plus the stoves already created
   * in Gladys under an earlier MAC address (with the features they have), so
   * the Discovery list never drops a device the user added.
   */
  devicesToPublish() {
    const language = this.config.language;
    const id = this.config.deviceId;
    const devices = [
      buildDevice(this.gladys, {
        id,
        info: this.info,
        language,
        created: this.createdRoles(this.createdDevice(id)),
      }),
    ];
    for (const device of this.createdDevices()) {
      const other = parseDeviceId(device.external_id);
      if (other !== id && devices.length <= OTHER_STOVES) {
        devices.push(
          buildDevice(this.gladys, {
            id: other,
            info: undefined,
            name: typeof device.name === 'string' ? device.name : undefined,
            language,
            created: this.createdRoles(device),
          }),
        );
      }
    }
    return devices;
  }

  async publishDevices() {
    if (this.readAt === undefined || !this.config.deviceId) {
      return;
    }
    const devices = this.devicesToPublish();
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** Queues the states of the stove read (the features created in Gladys only). */
  queueAll(created = this.createdFeatures()) {
    if (!this.info || !this.config.deviceId) {
      return;
    }
    const ids = deviceIds(this.gladys, this.config.deviceId);
    for (const { role, ...value } of statesOf(this.info, this.config.language)) {
      const id = ids.feature(role);
      if (created.has(id)) {
        this.publisher.push(id, value);
      }
    }
  }

  badge(id) {
    if (id !== this.config.deviceId) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: both(
          'Not the stove of the configuration (another MAC address).',
          'Pas le poêle de la configuration (autre adresse MAC).',
        ),
      };
    }
    if (this.blocked || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishBadges() {
    const entries = [];
    for (const device of this.createdDevices()) {
      const id = parseDeviceId(device.external_id);
      const entry = { external_id: device.external_id, ...this.badge(id) };
      const json = JSON.stringify(entry);
      if (this.badges.get(device.external_id) !== json) {
        entries.push([device.external_id, json, entry]);
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries.map(([, , entry]) => entry));
      for (const [externalId, json] of entries) {
        this.badges.set(externalId, json);
      }
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueAll(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /**
   * Time left before a read asked by hand (button, Discovery): at least
   * max(30 s, interval) after the last attempt, failed ones included.
   */
  manualWait() {
    const gap = Math.max(TIMINGS.testCooldown, this.config.pollInterval * 1000);
    return Math.max(0, this.client.lastRequestAt + gap - this.now());
  }

  /** The Discovery tab asks for a scan: a fresh read only if the last attempt is old enough. */
  async scan() {
    if (
      this.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      this.manualWait() === 0
    ) {
      await this.tick();
      return;
    }
    await this.publishDevices();
  }

  /** Every feature is read only: a command is refused, nothing is sent. */
  async setValue() {
    throw new Error(word(T.readOnly, this.config.language));
  }

  // --- Configuration button --------------------------------------------------

  pauseMessage() {
    return this.ratePaused ? T.rateLimited(age(this.pausedUntil - this.now())) : undefined;
  }

  async testConnection() {
    const missing = this.configMessage();
    if (missing) {
      return missing;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.running) {
      return T.busy;
    }
    const withLast = (first) => (this.lastMessage ? join(first, this.lastMessage) : first);
    // During a backoff, the button never reads.
    if (this.pauseKind === 'backoff' && this.now() < this.pausedUntil) {
      return withLast(T.test.wait(age(this.pausedUntil - this.now())));
    }
    // Never closer than max(30 s, interval) to the last attempt; after refused
    // credentials this is the only wait before an immediate retry.
    const wait = this.manualWait();
    if (wait > 0) {
      return withLast(T.test.wait(age(wait)));
    }
    // Refused credentials are retried at once; the stop is lifted only by a
    // successful read (run).
    await this.tick({ force: this.blocked });
    return this.lastMessage ?? T.noConfig;
  }
}
