# Notices and credits

This plugin is free software (MIT licensed) with **no ads and no telemetry**.

- **HWiNFO** is a product of Martin Malík / REALiX, s.r.o. (<https://www.hwinfo.com>).
  This plugin is an independent project and is not affiliated with or endorsed by REALiX.
  It reads HWiNFO's *Shared Memory Support* interface and its Gadget-registry
  reporting, features HWiNFO itself provides for third-party integrations.
- The **shared-memory struct definitions** in `src/hwinfo/` were written for this project
  from the publicly documented field layout of the HWiNFO shared-memory interface
  (header magic, section offsets/sizes taken from the live header at runtime). No
  third-party source code was copied.
- Original idea: the first HWiNFO Stream Deck plugin, written in Go by
  **@shayne** (<https://github.com/shayne>).
  This project is a ground-up rewrite on the official Elgato SDK and shares no code with it.
- Built with the official **Elgato Stream Deck SDK** (`@elgato/streamdeck`)
  and **sdpi-components** (MIT, Elgato, <https://sdpi-components.dev>;
  vendored as `ui/sdpi-components.js` from the official distribution). The
  HWiNFO bridge (`bin/hwsm.node`) is this project's own N-API addon, built
  from `native/hwsm` and covered by the same MIT license.
- **ws** (MIT, Einar Otto Stangvik and contributors,
  <https://github.com/websockets/ws>), the SDK's WebSocket client to the
  local Stream Deck app, bundled into `bin/plugin.js`.
