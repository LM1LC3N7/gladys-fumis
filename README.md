# gladys-fumis

[Gladys Assistant](https://gladysassistant.com) external integration for
**pellet stoves with a Fumis WiRCU module** (Austroflamm, Haas+Sohn,
Westfeuer…), through the Fumis cloud (`api.fumis.si`), **read only**: state,
room temperature, setpoint, power level, heat output, pellet level, errors and
warnings, counters, and a scene trigger on a new error or warning.
Unofficial, not affiliated with Fumis nor with the stove makers. The cloud
API is not documented officially by Fumis.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Never tested with a real stove: tested
> against a fake cloud only.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (FumisApp) ⇄ src/client.js ⇄ GET https://api.fumis.si/v1/status
                                   ├─ src/fumis.js      the answer, codes (pure)
                                   ├─ src/devices.js    -> Gladys device and states (pure)
                                   ├─ src/store.js      /data: pause, stop on refused credentials, codes seen
                                   └─ src/publisher.js  300 states and scene events/min
```

- **Reading**: `GET https://api.fumis.si/v1/status` with the MAC address
  (`username` header, 12 hex digits, upper case) and the PIN (`password`
  header), as the reference does, every 60 s (60 to 3600), one request at a
  time, never two closer than 3 s. Our own `User-Agent` (`gladys-fumis`),
  never a vendor app's; no `appname` (the reference sends none). The headers
  are built in `src/client.js` only and never logged nor shown; nothing
  secret is in the URL. A 200 holding an error envelope (`{"code": 401}` or
  `404`) is handled as that status. An answer whose `stoveLastAvailability`
  is more than 10 min behind `currentTime` counts as the stove offline (its
  old values are not published).
- **The answer is untrusted**: read up to 256 KB (`src/http.js`), parsed once,
  then only own keys of the expected shapes are read (`Object.hasOwn`), lists
  cut to 32 entries (512 diagnostic variables), numbers finite only (numeric
  strings accepted, as the API sends some), a plausible range per feature: no
  prototype pollution, linear passes.
- **Device**: `ext:<selector>:fumis:<16 hex digits of scrypt(MAC address,
"gladys-fumis", N = 2^15)>`, derived once per MAC address, never from the
  PIN: stable for the module, and the MAC address never reaches Gladys as
  is. This id is **no secret** (WiRCU MAC addresses share the 00:16:D0
  prefix, so the 2^24 candidates can be tried back; scrypt only makes that
  take days instead of seconds): the PIN is the secret. The heat output is
  `kw` while burning (status 30 or 110), 0 when off, nothing in the other
  phases (`kw` may keep the nominal power while off). Every feature is read only; the room
  temperature is `temperature-sensor/decimal`, the setpoint and the combustion
  chamber `temperature-sensor/probe` (°C); hours are `duration/decimal`; kW
  and % have no unit (the core lists none for their categories). A
  republished device keeps the features it was created with; a stove created
  under an earlier MAC address stays in the Discovery list with a degraded
  badge. The roles are frozen in `test/fixtures/roles.json`.
- **Alarms**: `error`/`error-code` (E…), `warning`/`warning-code` (A…), with
  the reference's labels; the scene trigger `stove_alarm` (`message`, `code`,
  `kind`) fires when a code differs from the one last seen and is not 0. A
  code is an integer from 0 to 999 (one check, `readCode`, shared by the
  answer and `/data`): any other value keeps the known code and fires
  nothing. The codes seen are kept in `/data` (written again at the next read
  when a write failed); without a valid memory a code is only learnt.
- **Errors**: 401 = refused credentials: a stop, new try after 10 min, 1 h,
  then every 6 h, lifted only by a successful read or new settings; 404 =
  stove not connected to the cloud; 429 = a pause of Retry-After between 60 s
  and 6 h for every path; 404, stale answer, 400, 403 (maybe a refusal of
  third-party clients: the status says so), 5xx, network, bad JSON: a backoff
  of 1, 2, 5, 10, 15 min, never under the interval. The stop and the pause are
  kept in `/data` (0600, with the stove key, never the PIN), capped when read
  back; a 429 pause or a backoff of the cloud itself (not of the stove) holds
  when the MAC address changes. The test button and Discovery read only when max(30 s, interval)
  has passed since the last attempt. A reconnection to Gladys resends the
  status, the Discovery list and the badges, and keeps the pause, the stop and
  the client.
- **Read only**: `onSetValue` refuses every command; the client has no write
  method; no switch, no thermostat, no writable feature, no scene action, no
  boolean option. See `TODO.md` for what a v2 could allow.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fumis.js` holds answers shaped like the reference's fixtures
(made-up values). `test/helpers/fakeCloud.js` is a fake cloud behind the
transport.

## Credits

- [frenck/python-fumis](https://github.com/frenck/python-fumis) 0.4.2 (MIT):
  the cloud API, the fields, the status, error and alert codes are ported to
  JavaScript.
- Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic is MIT (python-fumis),
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Fumis, WiRCU and the
stove brands are trademarks of their owners; this project is not affiliated
with them.
