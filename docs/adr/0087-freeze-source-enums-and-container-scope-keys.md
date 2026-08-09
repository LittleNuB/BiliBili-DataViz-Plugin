---
status: accepted
---

# Freeze source enums and container-scope keys

Canonical video and part `availabilityState` is `pending_verification`, `available`, or `unavailable`. Migration and restore create pending snapshots; only a successful authoritative source read makes one available, while a failed, partial, or cancelled read preserves the prior state. Source `sourceKind` is `favorite` or `watch_later`, and container `syncCompleteness` is `legacy_unverified`, `incomplete`, or `complete`; only `complete` authorizes absence-based relationship removal.

`ownerScopeId` is either a connected account's random local UUID or the reserved exact value `legacy-v13`. `externalContainerId` is a canonical decimal string: favorite folders use a positive real `mediaId`, while the one watch-later container and an upgrade-era ungrouped-favorite container use `0` within their distinct source kinds. `containerScopeId` is exact ASCII `ksc1|<kindLength>:<sourceKind>|<ownerLength>:<ownerScopeId>|<containerLength>:<externalContainerId>`, where each length is the following ASCII value's decimal character count with no leading zero. Length prefixes prevent delimiter ambiguity, and no external account identifier enters the key.

A canonical BVID trims surrounding ASCII whitespace, must match `^BV[0-9A-Za-z]{1,62}$`, and otherwise preserves exact case. The deliberately format-tolerant 3-to-64-character boundary avoids guessing a new platform format while rejecting blank, Unicode-lookalike, path-like, or unbounded values. An input that fails this contract remains in its existing source store and cannot create a canonical video until a real authorized source supplies a valid BVID.
