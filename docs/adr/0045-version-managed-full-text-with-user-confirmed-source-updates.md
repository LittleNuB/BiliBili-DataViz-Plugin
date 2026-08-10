---
status: accepted
---

# Version managed full text with user-confirmed source updates

Each exact video, part, language, and natural source-type scope has at most one current immutable full-text version. Identical reacquisition only refreshes verification time, while changed body or timeline content remains a temporary “字幕有更新，待确认” candidate until user confirmation atomically makes it current and retains the former version as read-only history. Historical versions remain readable, searchable, backed up, and capacity-counted but cannot support new current factual answers; capacity failure leaves the existing current version unchanged.
