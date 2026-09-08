# Live incident: HWiNFO stopped during NVIDIA driver update

Observed September 7, 2026. Times below are PDT (UTC-07:00).

## Conclusion

The installed deck reported `HWiNFO stalled / check sharing` because its
Shared Memory producer had crashed. Windows recorded HWiNFO64.exe crashing
inside NVIDIA's `nvml.dll`; the user confirmed updating the GPU driver.
SetupAPI independently places the driver replacement seconds before the
crash. Local crash-dump metadata confirms that the fault occurred in the
old nvml.dll while old and new NVIDIA libraries coexisted in HWiNFO. This
strongly supports driver replacement as the trigger. The exact internal
NVIDIA/HWiNFO failure still requires a full stack and instruction analysis.

The development changes were not installed. The live plugin remained
1.6.0.0, PID 26256, started September 6 at 17:30:48. Its directory was an
ordinary installed directory, not a link to a development worktree. Its
bundle and native file timestamps were September 5 UTC, before this work.
No installed plugin, HWiNFO configuration or Stream Deck settings were
changed during the incident investigation.

## Evidence chain

| Time | Observation |
| --- | --- |
| 18:12:43-18:12:49 | Earlier socket-close harness briefly opened real Shared Memory read-only, then exited successfully. No live writer or deliberate mutex hold ran. |
| 18:30:39.945 | Windows SetupAPI completed display driver installation, version 32.0.16.1686, successfully. |
| 18:30:41.000 | Last producer poll timestamp remaining in Shared Memory. |
| 18:30:42.519 | Application Error event 1000: HWiNFO64.exe 8.48.5990.0, PID 33224, faulting nvml.dll 8.17.16.1664, offset 0xf3ea0, exception 0xc0000005. |
| 18:30:45 | Local Windows crash dump for that HWiNFO PID written. It was not uploaded or committed. |
| 18:39-18:42 | Process inventories found Stream Deck and its installed plugin alive, but no HWiNFO process. |
| 18:42:09-18:42:19 | Six reads using the installed Node 20 runtime and installed native bridge succeeded. All 262,848-byte snapshots had the same timestamp and SHA-256; no read timed out on the mutex. |

The driver currently reported by Windows is 32.0.16.1686 on the RTX 4090.
The faulting library version in the event is the earlier 8.17.16.1664.

The local dump's exception and module records independently identify a read
access violation in nvml.dll 8.17.16.1664 at offset 0xf3ea0. The same dump
contains nvml.dll 8.17.16.1686, nvapi64.dll 32.0.16.1686 and
nvapi64_impl.dll 32.0.16.1664. This is evidence of mixed driver generations,
not an assertion of the exact bad call or pointer. No debugger was installed;
only documented minidump metadata was parsed locally. No memory contents or
dump were uploaded, and no symbolic stack unwind was claimed.

Snapshot SHA-256:
`e1701ab3cfda35a393b4644c53a5551790f02a9542e81a83adee5e52b600f3aa`.

Installed bundle SHA-256:
`a99b61e7a6c08202cd9f0a7c07f7cf57af1cb1469fd2d7fff415c6181125ba8b`.

Installed native SHA-256:
`d32cdd097af8c3f094d4740ceb1e66b3254fd4bb4d5c7082b5b8b29700ede475`.

## Why the deck said stalled

The installed poller treats a producer timestamp that has not advanced for
more than 15 seconds as stale. A readable mapping can outlive the producer;
its presence is not evidence that HWiNFO is still running. The retained
mapping here contained a valid signature and frozen data, rather than a
disabled-sharing signature. The dial therefore displayed the stale screen.
No live event records the exact screen-transition time, so it is not
claimed as a measured 15-second transition.

The crash and frozen source are confirmed. The observations do not support
an installed candidate regression, a busy mutex, or a detected free-version
expiry as the cause of this incident. They also do not imply that every
future NVIDIA crash has the same cause.

## Recovery and limits

Finish the driver installation and any restart it requests, then start
HWiNFO again. Verify advancing producer timestamps and the deck's recovery;
the investigation did not restart either application or claim recovery
without observing it. Close HWiNFO before subsequent GPU-driver updates.
The [HWiNFO author's support response](https://www.hwinfo.com/forum/threads/hwinfo64-crashing-during-nvidia-driver-update-on-windows-11.9278/)
recommends avoiding concurrent monitoring during driver updates. That thread
also records a later workaround for its historical reproduction; it is not
proof of the exact cause or affected versions of this incident.

Raw local evidence is retained under the qualification worktree's ignored
`release/audit-evidence/incident-20260907/`: event XML, installed log/hashes,
driver-install excerpt and scalar-only read results. No sensor labels or
crash-memory contents were published. All deliberate fault fixtures reviewed
used separate named mappings/mutexes and isolated registry keys.
