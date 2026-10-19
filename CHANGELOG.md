# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-fumis/commits/main
