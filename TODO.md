# TODO — Fumis WiRCU v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core, read only** (2026-10-19): Fumis cloud
      (`GET /v1/status`, MAC address and PIN headers), bounded and untrusted
      answer, one device per stove (scrypt of the MAC address), state, phase,
      temperatures, power, pellet level, errors and warnings with the
      `stove_alarm` scene trigger, counters, careful reads (60 s, 3 s gap,
      backoff, stop on refused credentials, 429 pause, all in `/data`),
      badges, test button, en/fr, docs, cover. Tested against a fake cloud
      only (Node 22 and 24). The store validator was not run by the
      development session (it cannot run it): to run before the release.
- [x] **Review fixes** (2026-10-19, review of 4b9c232): heat output only
      while burning (0 off), stove key by scrypt (no secret, documented),
      one code check (`readCode`, 0 to 999) for the answer and `/data`
      (an invalid memory is no memory), the codes written again after a
      failed `/data` write, a cloud pause kept across a MAC change, a stale
      answer (stove unseen > 10 min) as offline, no `appname`, a status
      hinting at a refusal of third-party clients on 400/403, an error
      envelope in a 200 handled as its status.
- [ ] **Milestone 2 — real stove**: run against a real stove (an Austroflamm
      and another brand if possible), compare with the app (see "To check");
      turn the answers (anonymized: MAC address, IP and PIN removed) into
      fixtures.
- [ ] **Milestone 3 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## v2: commands (not in v1)

What a v2 could allow, **behind an option off by default**
(`allow_commands`, like the flame appliances of gladys-edilkamin), as
`button/push` or `select` features only, **never as a switch or a binary**
(Google Home, Alexa, HomeKit, MCP and `switch.*` scenes would drive it, an
"all off" too):

- the setpoint (`set_target_temperature`, `{"temperatures":[{"set":…,"id":1}]}`),
  bounded to the range the stove shows;
- the power level (`{"power":{"setPower":1..5}}`);
- the eco mode (`{"ecoMode":{"ecoModeEnable":0|1}}`);
- **maybe** turning off (`{"command":1}`) by a button behind its own option.

**Never by a switch, and not without a decision of Louis: lighting the stove**
(`{"command":2}`). Never ported: the delayed start and stop, the weekly
timer, the clock sync, the fuel quality and the fan speed.

The reference writes with `POST /v1/status/` (trailing slash, a POST without
it may answer 301) and a body `{"unit":{"id":MAC,"type":0,"pin":PIN},
"apiVersion":"1","controller":{…}}`: the PIN goes in the body too. The cloud
relays the command to the stove on its next poll (2 to 5 minutes, RESEARCH.md
of the reference), with no confirmation. A v2 would have to: serialize the
commands (shared with the reads, 3 s gap), decide only on a state read again
just before (refuse when unknown or stale), check the option again right
before sending, validate values strictly (`null` or `''` are no 0), answer
within Gladys' 5 s ack (refuse after ~3.5 s, never send after a failure
shown), and announce "sent, not confirmed" (never "not sent" for a request
that may have left), then read again sooner to show the effect.

**Why v1 is read only**: a pellet stove is a flame appliance; the API is not
documented by Fumis; commands are relayed by the cloud minutes later without
confirmation; the integration was never tested with a real stove. Reading
first, with real feedback, is the safe order (as gladys-oekofen).

## To check on a real stove

- The answer to a wrong MAC address or PIN (401 with
  `{"message":"A unit controller with that mac and pin doesn't exist"}` in
  the reference fixtures), to a stove offline (404 "Stove not connected"),
  and whether a 404 can also mean an unknown MAC address.
- The `Content-Type` of the answers (the reference refuses anything but
  `application/json`; an empty header is accepted here).
- Whether a read every 60 s is fine for weeks (the reference recommends 30 s).
- The exhaust temperature: the reference reads `var[11]`, its RESEARCH.md
  saw the exhaust gas at `var[4]` on a Clou Duo: not published in v1.
- The door (`var[33]`, 0 = open) on other models than the Clou Duo (211/15):
  published for that model only.
- The pellet level on stoves without a fuel estimate (0 with
  `quantityActualType` 0 and no `quantityDisplay`: not published then).
- `kw` in each phase (the reference fixtures show 7 kW while off; its
  RESEARCH.md says it lags behind the power level): v1 publishes it only
  while burning (status 30, 110), 0 when off (0, 1, 2), nothing in the other
  phases. Check whether ignition, eco and cooling give a meaningful value.
- `stoveLastAvailability` against `currentTime`: whether the gap really grows
  when the WiRCU module is off (and the API answers 200 with old values
  rather than 404), and whether 10 min is the right threshold (the module
  updates the cloud every ~30 s).
- Whether the cloud accepts our own `User-Agent` (`gladys-fumis …`) without
  `appname` (the reference sends `PythonFumis` and no `appname`, and the HA
  integration works), and what a refusal of third-party clients looks like
  (400? 403? an HTML page?).
- Whether a 200 can hold an error envelope (`{"code":401}`): handled as the
  status it names, just in case.
- `timeToService` units (hours per the reference) and its sign when overdue.

## Decisions

- **Not a duplicate** (lot 9, wave 2): no Fumis module on the store, GitHub,
  the forum thread 10385 or the tracker at the research of 2026-10-19
  (`_ref/lot9/proposition.md`); the reservation checks are the main
  session's.
- **Reference reused: frenck/python-fumis 0.4.2** (MIT, maintained, the
  library of the Home Assistant core integration), cloned read only in
  `_ref/fumis` (tag v0.4.2, commit eaf74f6 of 2026-10-17; licence read in
  `LICENSE.md`: MIT, Copyright (c) 2019-2026 Franck Nijhof). Python: ported,
  credited in the README and `THIRD_PARTY_NOTICES.md` (full MIT notice,
  copied into the image). Only runtime dependency: the SDK.
- **Neighbour modules**: LM1LC3N7/gladys-edilkamin (a cloud pellet stove: its
  review lessons are applied) and LM1LC3N7/gladys-oekofen (a flame appliance
  read only in v1: same structure, careful reads, `/data`, badges, test
  button). Neither was modified.
- **Read only** (brief): every feature `read_only`, `onSetValue` refuses
  every command, the client has no write method, no switch, no thermostat
  (the setpoint is a `temperature-sensor/probe`), no scene action, no boolean
  option. Ignition, shutdown and setpoint are not offered; a v2 is described
  above (never ignition by a switch).
- **Undocumented API** (brief): said in the manifest intro, the docs (fr/en,
  "API non documentée officiellement" / "API not documented officially"),
  the README and the CLAUDE.md; tested in `test/manifest.test.js`.
- **No identity imitation** (brief): `User-Agent` `gladys-fumis
(+https://github.com/LM1LC3N7/gladys-fumis)`, as the reference sends its
  own (`PythonFumis`); no `appname` header (the reference sends none; review
  point 7); no vendor app name, no browser User-Agent, no TLS fingerprint
  change (plain Node `https`). A 400 or 403 shows a status saying the cloud
  may refuse third-party clients (a backoff, never a stop).
- **The PIN** (brief): a `secret` field, described as "kept by Gladys in its
  database, never shown again, sent only to the Fumis cloud" (a `secret`
  field is stored in clear in the Gladys database; the docs never claim
  otherwise, `test/encoding.test.js` checks it). It goes in the `password`
  header of each read (the API's own scheme), never in a URL: the URL is the
  constant `https://api.fumis.si/v1/status`. Checked as printable ASCII
  without spaces (no header injection), 64 characters at most.
- **The MAC address is half of the credential**: never logged, nor in a
  status, nor in `/data`, nor in Gladys. The stove key is
  `scryptSync(MAC, 'gladys-fumis', 32, { N: 2 ** 15 })` (review point 2;
  derived once per MAC address and cached, never from the PIN): its first 16
  hex digits are the device id, its first 32 key `/data`. The key is **no
  secret**: WiRCU MAC addresses share the 00:16:D0 prefix, so the 2^24
  candidates can be tried back (seconds with a plain hash, days with this
  scrypt); the docs say so, the PIN is the secret. Nothing was published, so
  the ids changed from the sha256 of 4b9c232 without migration. The API
  answer also holds the MAC address (`unit.id`) and the local IP
  (`unit.ip`): neither is read. Tests check the PIN and the MAC address (all
  spellings) are absent from the logs, the statuses, the requests to Gladys
  and `/data`.
- **One stove per integration**: the WiRCU credentials are per stove. A stove
  created under an earlier MAC address stays in the Discovery list with its
  features and a degraded "unreachable" badge (5 at most), so nothing is lost.
- **Careful reads**: 60 s by default and at least (the reference recommends
  30 s, the cloud refreshes every ~30 s). One request at a time, 3 s minimum
  gap for every path; the test button and Discovery read only when
  max(30 s, interval) has passed since the last attempt and no pause holds;
  after an error never faster than the interval; no retry inside a cycle.
  Request timeout 20 s (the reference: 60 s). Redirects are not followed.
- **Errors**: 401 = refused credentials (the reference's
  `FumisAuthenticationError`): a stop with new tries after 10 min, 1 h, then
  every 6 h; new settings lift it at once; the test button retries at once
  once the interval has passed; only a successful read lifts it (also in
  `/data`). 404 = stove offline (`FumisStoveOfflineError`): a backoff, never a
  stop (the stove may be off for the summer). A 200 whose `stoveLastAvailability`
  is more than 10 min behind `currentTime` is the same (`stale`: badge
  unreachable, status "stove not seen for …", no state published, the codes
  seen untouched). A 200 holding an error envelope `{"code": 401|404}`
  without a controller is handled as that status. 400 and 403 = a refusal of
  the request (maybe of third-party clients), not of the credentials: a
  backoff. 429 = a pause of
  Retry-After between 60 s and 6 h (5 min when absent) for every path. 5xx,
  network, timeout, bad JSON or a non-JSON `Content-Type`: backoff 1, 2, 5,
  10, 15 min, never under the interval. The stop and the pause are in
  `/data`, capped when read back (6 h for a 429, 1 h for a backoff); after a
  restart the first read waits for the end of the pause; a reconnection to
  Gladys keeps them. A pause of the cloud itself (429, 5xx, 400/403,
  network, bad answer: `cloud: true` in `/data`) holds when the MAC address
  changes; the backoff of an offline or stale stove is that stove's and is
  dropped (review point 5).
- **Untrusted answer**: 256 KB at most (the reference fixtures are 14 to
  20 KB), parsed once (a BOM dropped), only own keys read (`Object.hasOwn`),
  lists cut to 32 entries and 512 diagnostic variables, numbers finite only
  (numeric strings accepted: the API sends `rssi`, `kw`, `timeToService` as
  strings), a plausible range per feature (out of range: no value sent, the
  feature kept). Code tables looked up with `Object.hasOwn`.
- **Values** (reference `models.py`): the main temperature is the channel on
  the main screen with a sensor (`actualType` > 0), else the first one; the
  setpoint only when `setType` > 0; the combustion chamber is channel 7 with a
  sensor; `setPower` is the power level (the reference: `actualPower` only
  mirrors it, not published); `kw` is the heat output while burning only
  (status 30, 110), 0 when off (0, 1, 2), nothing in the other phases
  (review point 1: the reference fixtures show 7 kW off); the pellet level is
  `quantity` × 100 when the stove estimates it (`quantityActualType` > 0 or a
  `quantityDisplay`); `timeToService` -1 = no counter; `heatingTime`
  (seconds) as hours; the Wi-Fi signal with the reference's formula.
- **States**: `state` = the reference's simplified state (off, heating up,
  ignition, burning, eco, cooling, unknown), `phase` = the detailed status
  label (or "Unknown phase (n)"), `active` = the reference's `on` (unknown
  status: no value).
- **Alarms**: `error`/`error-code` and `warning`/`warning-code` with the
  reference's codes (`E%03d`, `A%03d`) and descriptions translated in French.
  The scene trigger fires when a code differs from the one last seen and is
  not 0 (the same code fires again only after it cleared); the codes seen are
  in `/data`, per stove. One check, `readCode` (src/fumis.js), for the
  answer and `/data` (review point 3): a code is a JSON integer from 0 to
  999, anything else (-1, 1e6, a string) is undefined, keeps the known code
  and fires nothing. An invalid memory is no memory. Without memory, or for
  a code not seen yet (absent from the first reads), a code is only learnt.
  The codes stay "to write" until a `/data` write succeeds and are written
  again at the next read (review point 4; a stop right after a failed write
  can still fire once again at the restart). Variables `message`, `code`,
  `kind`.
- **Units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): `celsius` on
  `temperature-sensor`, `hours` on `duration/decimal`; kW and % have no
  category that lists them for these values: no unit, the unit in the
  feature name. The heat output is **not** an energy-sensor feature nor
  `publishEnergyConsumption` (the core would count thermal power as
  electricity). The room temperature is `temperature-sensor/decimal` (the
  stove's ambient sensor); the setpoint and the combustion chamber are
  probes (kept out of the room averages).
- **External ids**: `ext:<selector>:fumis:<stove key>:<role>`, roles frozen in
  `test/fixtures/roles.json`. A feature appears when the answer has the
  value, and stays once created (read from `gladys.devices`).
- **Logs**: never the PIN, the MAC address nor a header; `errorReason` never
  prints an unknown error's message; Node's socket messages replaced by their
  code.
- **Template demo files removed** (devices, scenes, widgets, weather and
  their tests).
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag: the one-time exception to "versions
  belong to the Release workflow" (the template's 1.0.0 had to be replaced);
  the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text (appendix placeholder, no
  personal name); `THIRD_PARTY_NOTICES.md` credits python-fumis (MIT, full
  notice); both copied into the image.
- **npm audit**: `npm audit fix` raised a dev dependency (brace-expansion,
  through ESLint) in the lockfile; `npm audit --omit=dev` finds nothing.
- **Cover**: `cover.png` 800×534 generated in plain Node
  (`_ref/make-cover-fumis.mjs`, no dependency).
