# Sprint 12: remote provenance architecture decision

Date: September 7, 2026. Reviewed commit:
`fa9ec6ddbe7c60008f9512b17eafeaa52fe245fd`, an integration candidate based
on the audit reference `2ca44e95c2d8b3442c3ed411952621b254d4cbf0`.
Work is isolated on `docs/audit-remote-plan-20260907`. No competitor source,
assets or schemas were inspected. This change adds documentation only.

**Decision: NO-GO for implementing or shipping a remote provider now.**
The local producer-contract gate remains open, and safe remote support
requires origin-aware routing, publisher enrollment, credential lifecycle
and recovery work that the current provider abstraction does not supply.
This is a bounded architecture experiment and an explicit product decision,
not a failed protocol implementation or a security certification.

## Current contracts inspected

| Production surface | Relevant invariant or limitation |
| --- | --- |
| `src/hwinfo/provider.ts` | One synchronous `read()` returns a snapshot, a skipped tick or an error. The source union contains only Shared Memory and Gadget. |
| `src/hwinfo/types.ts` | Reading keys and capabilities describe local measurements. Snapshots can be mutated in place between reads. There is no authenticated host origin, transport generation or remote age interval. |
| `src/poller.ts` | One retained poller selects one global local backend and distributes one global status. Local Auto deliberately prefers Shared Memory. Remote transport availability cannot safely become that global status. |
| `src/hwinfo/reading-links.ts` | Explicit links permit only local Shared Memory/Gadget endpoints with unit/type checks. Remote packets must never enter this alias mechanism. |
| `src/stats.ts` | Session boundaries cover source, unit, type and binding revision. Remote host identity and producer/connection epochs would require explicit boundaries. |
| `src/pi-protocol.ts` | The picker and preview identify the active local source. Neither represents authenticated host enrollment, host-specific availability nor sample-age uncertainty. |

Adding `remote` to `SnapshotSource` would not make remote identity safe. An
asynchronous receiver would need an immutable, validated snapshot buffer,
and remote lifecycle must not close, block or replace the local provider.
Bindings and rendering would need origin-specific status so one unreachable
remote computer cannot blank working local readings. The local-only startup
path must create no sockets, discovery traffic, credential files or remote
processes.

## Trust model for any future prototype

The remote publisher, its operating system and its sensor reader form the
measurement trust boundary. Authentication can identify the enrolled
publisher; it cannot prove that the publisher's sensor value is true or
that its key has never been copied. Encrypting a torn or old source sample
does not repair it. That is one reason the U1 source-contract gate comes
before remote implementation.

Assume the network can delay, duplicate, reorder, drop and replay traffic,
and can point a saved network address at another computer. Assume an
unauthorized client can reach a publisher's listening port. Treat every
received label, type, unit, number, count and protocol marker as untrusted
input even after the connection is authenticated. A compromised enrolled
publisher can lie within its own origin; it must not obtain local sensor
bindings, executable commands or control of the Stream Deck host.

The design would use a maintained TLS implementation with mutual endpoint
authentication and encryption. TLS 1.3 defines client/server authentication
and protected transport, but its early-data mode has distinct replay
limitations. The experiment would disable early data and require a fresh
application session before any measurement is accepted. This is a design
choice, not a claim that TLS alone establishes sample freshness.
[RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html#section-8)

An endpoint address is routing information. It cannot become the identity
of whichever server responds today. The identity check must use the
reference established during enrollment, independently of an untrusted
peer's claimed name. If ordinary certificate/DNS service identities are
used, verification must follow the service-identity rules rather than
accepting arbitrary presented names.
[RFC 9525](https://www.rfc-editor.org/rfc/rfc9525.html)

## Stable host identity and pairing

The conceptual pairing record would contain a locally assigned immutable
origin ID, a pinned enrollment public-key fingerprint, a user-chosen host
label, permitted client credentials, and explicitly approved endpoint
addresses. The immutable origin ID maps to that authenticated principal;
it is not copied from an incoming label or assigned from connection order.
Display names, IP addresses and DNS names may change without rebinding
measurements. A different enrollment identity at the same address is an
identity mismatch, never an automatic replacement.

Enrollment must be explicit at both ends, with an out-of-band comparison
of a sufficiently strong fingerprint or authenticated enrollment code.
The target operator chooses which readings this client may query. No
automatic LAN discovery, public relay, anonymous endpoint or software
installation is part of the prototype. Pairing cancellation leaves all
existing local and remote records unchanged.

A conceptual remote key is a structured tuple of origin ID, local backend
kind and producer reading identity. Serialization must be injective and
use a reserved namespace disjoint from local triples and `g:`/`g2:` keys.
The receiver derives the namespace from its authenticated pairing record,
not a packet's `hostId` field. A packet cannot request local aliases or
write action settings. No name, address, value similarity or connection
position can produce a local-to-remote binding.

If two concurrent publisher instances present the same enrolled identity
but incompatible producer epochs, expose a host-identity conflict and stop
that origin. Do not silently choose the newer socket. This may detect a
cloned enrollment; it does not prove that every credential copy is
detectable. Replacing a lost or compromised enrollment key requires an
explicit review and new pairing. It never silently inherits the previous
origin's trusted sensor selections.

## Proposed acceptance rules, not an implemented wire format

| Condition | Required behavior |
| --- | --- |
| New authenticated connection | Client assigns an attempt generation before dialing, issues a fresh unpredictable challenge after TLS authentication, and accepts only the matching active generation/session. No cached frame becomes a first live sample. |
| Handshakes finish out of order | An obsolete attempt cannot replace the current session. Origin assignment comes from the saved pairing, so reordered connections cannot swap host ownership. |
| Snapshot envelope | Validate protocol version, authenticated session, producer epoch, sequence, backend/capabilities, source evidence, topology revision and bounded readings before publishing anything. No partial snapshot application. |
| Duplicate or lower sequence | Reject for live publication and statistics. Retain a bounded diagnostic count; never refresh age from the duplicate. Sequence numbers use an explicitly bounded exact integer representation. |
| Sequence gap | A later valid complete snapshot may replace the latest one. Record the gap and end affected sample histories; do not invent intervening measurements. Delta-only frames are outside the first experiment. |
| Producer restart or unit/capability change | Start a new explicit measurement epoch, invalidate affected cached evidence and end the relevant histories. Authentication surviving a restart does not preserve sample history. |
| Disconnect or timeout | Mark that remote origin unavailable or last-known with age. End confident sampling/alerts. Keep local acquisition and other origins independent. |
| Reconnect | Exponential backoff with jitter, a maximum delay, a bounded handshake timeout and one pending attempt per origin. A new session must re-establish source evidence; no unbounded replay queue is drained into live display. |
| Unknown or malformed data | Reject the whole envelope; bound diagnostics and disconnect repeated violators. Never interpret unknown message types as commands or source selection. |
| Host identity changes | Stop the affected origin and require explicit replacement review. Keep previous bindings stored and missing; never redirect them to the new identity. |

The first hypothetical experiment would allow one configured remote host,
one pending handshake and one latest complete snapshot. A proposed envelope
ceiling is 256 KiB with at most 1,024 readings and bounded string lengths;
the parser must reject oversized content before unrestricted allocation.
Transport buffers, decoded representation and any diagnostics need separate
hard limits. Compression is outside the experiment. These are proposed
research limits, not measured performance budgets or release approval.
The existing local resource gates would not be raised to accommodate it.

## Time and freshness

Transport arrival is an observation of transport, not a new sensor sample.
A heartbeat proves that an authenticated service answered; it does not
prove that HWiNFO polled. The publisher must carry producer evidence and
explicitly identify unknown sample age. Gadget's missing producer timestamp
must remain unknown remotely. Constant values are not by themselves proof
that either endpoint stopped.

Avoid subtracting the remote wall clock from the local wall clock as if the
two were synchronized. Within a validated producer epoch, the publisher
can report its monotonic elapsed time since confirmed producer evidence.
The receiver records its own monotonic receive time and increases any
reported age from that point. Transport delay and sampling uncertainty
remain part of the displayed bound; when a defensible bound is absent,
show age unknown rather than an exact freshness claim. A challenge/response
round trip alone does not prove the age of a previously cached sample.

Remote wall-clock fields may be optional diagnostics. Clock corrections,
backward jumps, sleep/resume or monotonic-epoch changes must invalidate any
derived age bound and end relevant histories. A fresh TLS session or a new
sequence number cannot override absent producer evidence. Confident alerts
require the same source-evidence policy as local measurements, plus valid
remote age classification.

## Operational cost and decision rationale

| Required responsibility | Cost that a provider class does not remove |
| --- | --- |
| Publisher installation and updates | Separate distribution, startup behavior, least-privilege sensor access, firewall guidance, crash recovery and version compatibility. No silent installer or security-control changes. |
| Secret storage | Per-endpoint private keys need protected local storage and access controls. Exported profiles, support reports and logs must exclude private keys and enrollment secrets. |
| Routine rotation | A short-lived transport credential may rotate under a still-trusted enrollment authority, with expiry and rollback protection. TLS traffic-key updates are not enrollment-key rotation. |
| Revocation | Local unpairing must immediately close sessions and reject future attempts, including resumptions. The publisher needs per-client revocation so a retired deck cannot keep reading. Offline revocation state must survive restart. |
| Lost or compromised enrollment | Explicit re-enrollment and binding review, plus instructions for revoking every affected client. An old-key signature alone is insufficient recovery after that key is compromised. |
| Backups and clones | Restoring identities on two machines can duplicate principals. Identity backup, ownership transfer and conflicting-instance recovery become supported user flows. |
| Support | Certificate expiry, denied access, identity mismatch, protocol mismatch, source unknown-age and network timeout need distinct, bounded, redacted diagnostics. Neither labels nor private endpoints should be uploaded automatically. |
| Resource and lifecycle qualification | Bounded parser memory, rejected-message costs, reconnect load and offscreen cleanup require measurement while local 250 ms acquisition and host rendering stay within their existing budgets. |

There is no demonstrated requirement or support evidence in this sprint
that justifies operating this additional agent and credential-management
surface for the solo local-first plugin. The current single-global-status
design also needs a larger routing change than adding a provider. The
decision is therefore NO-GO now. A future revisit requires a concrete user
need, an agreed supported publisher deployment model, ownership of the
credential/recovery lifecycle, closure of local source-integrity gates and
passing current-candidate resource qualification. Competitor feature
descriptions are not evidence that these costs are justified here.

## Evidence and unrun gates

This pass read the production contracts listed above and the relevant
authentication/replay and service-identity standards on September 7, 2026.
It did not implement a network listener/client, install a publisher, pair
hosts, open a remote sensor connection, change settings or add protocol
fixtures. No protocol, security, replay, reconnect or overhead test ran.
No runtime acceptance command is reported passed for this documentation
decision.

If reopened, executable production-path tests must cover unpaired clients,
wrong host keys, swapped/reordered connection establishment, retired session
generations, sequence replay, reconnects, producer epochs, stale cached
frames, clock offset/adjustment, queue limits, malformed/oversized input,
key rotation/revocation, cloned enrollment and local-only startup. Every
remote scenario must assert that local keys, local provider selection and
local settings cannot be changed by any remote packet. Benchmarks must
compare remote-off and remote-on with identical local workloads; no
invented overhead number is acceptable.

Rollback is simply reverting this documentation decision. There is no
remote runtime, listener, credential store or setting to disable or remove.
