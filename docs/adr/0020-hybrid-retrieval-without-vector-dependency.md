---
status: accepted
---

# Use hybrid retrieval without a vector dependency

Bili-Bill 0.14 uses always-available local hybrid retrieval as the source-selection baseline and treats local vector semantic retrieval as an independently validated enhancement rather than a release dependency. Cross-video generation is source-bounded: retrieval selects eligible videos or parts, then their complete primary text is sent only for a user-initiated answer and must produce exact citations; the product does not build a remote embedding index over the full knowledge space because that would introduce a broader privacy, provider, cost, and re-indexing contract.
