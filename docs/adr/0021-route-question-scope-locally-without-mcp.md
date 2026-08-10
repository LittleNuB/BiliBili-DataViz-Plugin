---
status: accepted
---

# Route question scope locally without MCP

Bili-Bill keeps one question input and resolves each turn locally to the current video, the personal knowledge space, or both; clear cross-video intent may broaden the scope, while ambiguity with an active video stays narrow and may offer a one-time broader retry. The in-extension path calls local knowledge retrieval directly rather than introducing a Skill selector or MCP hop, because those layers add routing, compatibility, lifecycle, and failure complexity without crossing a real system boundary; the same retrieval capability may still gain an optional MCP adapter for future external assistants.
