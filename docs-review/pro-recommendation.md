# Installation follow-up: HWiNFO Pro

Reviewed 24 October 2026 against documentation source `321f1d991ca57e427588092d0b847ef1e21091b2`.

## Change and reason

The Install page now says: **I recommend [buying HWiNFO Pro](https://www.hwinfo.com/licenses/) for continuous Shared Memory use without the 12-hour limit.**

This recommendation sits beside the Shared Memory setup steps and its HWiNFO min/max/average benefit. The adjacent free 12-hour limit, manual re-enabling option, explicit provider-link requirement, and Gadget limitations remain visible. The requirements still allow Free or Pro. Pro is recommended for continuous use; the copy does not make it a prerequisite for using Shared Memory or the plugin.

The single purchase link uses HWiNFO's official licensing page, where the user can choose a license. It does not choose a checkout product or quote a price.

## Evidence

- [Official HWiNFO licenses and purchase page](https://www.hwinfo.com/licenses/): the comparison lists a 12-hour Shared Memory limit for non-Pro and unlimited Shared Memory for Pro. Its qualification says time-limited sharing is automatically deactivated and can be manually re-enabled. The page supplies Buy Now links for subscription and lifetime options.
- The official page was fetched directly with normal certificate verification and a no-cache request. HTTP status: **200**. Response date: **24 October 2026, 22:24:58 UTC**. Response cache policy included `no-cache` and `no-store`. Captured HTML SHA-256: `75e1e039eeaf0c6d505f7d383c806bd35c870a293dc3b0c5183381bae1e3d341`.
- [Released v1.7.1 data-source reference](https://github.com/slawrensen/hwinfo-streamdeck/blob/v1.7.1/docs/data-sources.md): Shared Memory supplies HWiNFO statistics; Gadget supplies current values without the same statistics or producer timestamp. The follow-up retains these distinctions and changes no runtime behavior.

## Narrow validation

| Check | Result |
| --- | --- |
| Real Jekyll 3.10.0 build with Just the Docs v0.10.1 | PASS |
| Generated Install HTML contains the exact recommendation and one official licensing link | PASS |
| Free re-enabling, Free or Pro requirements, and Gadget limitations preserved | PASS |
| Install headings and IDs unchanged from the reviewed build | PASS |
| Provider link resolves under `/hwinfo-streamdeck/` and its target fragment exists | PASS |
| Recommendation included in the generated search index | PASS |
| Installation prose contains no em dash | PASS |

The isolated build wrote to `/tmp/hwinfo-pro-docs-build`; it did not replace the shared comparison builds. This is documentation and link validation, not HWiNFO license activation, a purchase, or physical-device qualification. Publication and final served-content verification belong to the coordinator's integration step.
