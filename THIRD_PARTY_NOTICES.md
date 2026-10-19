# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below. The ported parts were rewritten
in JavaScript; they are changed from the originals (another language, another
structure, only what this integration needs, read only). None of the original
code is copied as is.

## python-fumis

- Project: [frenck/python-fumis](https://github.com/frenck/python-fumis),
  version 0.4.2 (2026-10-17), the asynchronous Python client for the Fumis
  WiRCU API, by Franck Nijhof (the library of the Home Assistant Fumis
  integration).
- What is ported (in `src/constants.js`, `src/client.js`, `src/fumis.js`,
  `src/devices.js` and `src/i18n.js`): the base URL of the API and its status
  endpoint (`GET https://api.fumis.si/v1/status`), the MAC address and the PIN
  sent as the `username` and `password` headers, the meaning of the 401 and
  404 answers, the fields read (status, error, alert, temperature channels and
  the choice of the main one, power, fuel quantity, eco mode, statistics,
  time to service, RSSI, the diagnostic variables of the door and of the
  stove model), the status codes and their simplified states, the error and
  alert codes and their descriptions, the known stove model, the signal
  strength formula. The reference fixtures inspired the made-up test answers
  of `test/fixtures/fumis.js`. The commands of the library (turn on and off,
  setpoint, power, eco mode, timers) are **not** ported.
- Licence: MIT. Its full notice:

```text
MIT License

Copyright (c) 2019-2026 Franck Nijhof

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
