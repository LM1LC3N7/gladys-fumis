# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-19

### Added

- Pellet stoves with a Fumis WiRCU module (Austroflamm, Haas+Sohn,
  Westfeuer…) through the Fumis cloud, read only (ported from python-fumis
  0.4.2). The cloud API is not documented officially by Fumis.
- MAC address and PIN of the WiRCU module (the PIN in a `secret` field);
  neither is logged, shown, written to `/data` nor published to Gladys.
- One device: state, phase, operating, room temperature, setpoint (read
  only), combustion chamber temperature, power level, heat output, pellet
  level, error and warning with their codes, eco mode, door (Clou Duo),
  time to service, burning time, igniter starts, misfires, overheatings,
  Wi-Fi signal, when the stove sends them.
- Scene trigger "Fumis stove error or warning" (message, code, kind): a new
  error or warning code; never on the first read.
- Careful reads: every 60 s (60 to 3600), one request at a time, never two
  closer than 3 s; refused credentials stop the reads (new try after 10 min,
  1 h, then every 6 h); a 429 pauses every path for 60 s to 6 h; both kept in
  `/data`; other errors (stove offline included) back off, never faster than
  the interval.
- "Test the connection" button; the status, the Discovery list and the badges
  are sent again at each reconnection to Gladys.
- Device and feature names in French or English.

### Fixed

- The heat output is published only while the stove burns, and 0 when it is
  off (the stove may keep reporting its nominal power when off).
- The device id is derived from the MAC address with scrypt (it is no
  secret; the PIN is).
- An error or warning code that is not an integer from 0 to 999 no longer
  fires the scene trigger, nor again at each restart; an invalid memory in
  `/data` only learns.
- The codes seen are written again at the next read when a `/data` write
  failed.
- A 429 pause or a cloud error backoff is kept when the MAC address changes.
- An answer from a stove the cloud has not seen for more than 10 minutes is
  handled as the stove offline (old values no longer shown as live).
- No more `appname` header; a 400 or 403 says the cloud may refuse
  third-party clients.
- An error envelope (`{"code": 401}` or `404`) sent with a 200 is handled as
  that status.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fumis/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-fumis/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-fumis/releases/tag/v0.1.1
