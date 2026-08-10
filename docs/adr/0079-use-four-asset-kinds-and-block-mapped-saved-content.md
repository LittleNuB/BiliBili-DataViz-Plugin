---
status: accepted
amends: 0078
---

# Use four asset kinds and block-mapped saved content

Version 14 exposes four stable asset kinds: `note`, `bookmark`, `excerpt`, and `saved_answer`. An excerpt's immutable content kind is one of `source_excerpt`, `generated_highlight`, `generated_summary`, or `answer_excerpt`; a saved answer uses `qa_turn`. Immutable saved content is an ordered non-empty array of text blocks, and `savedQuestion` is required for `answer_excerpt` and `qa_turn`. Each evidence version maps to zero or more unique in-range block ordinals rather than fragile character offsets; source-backed excerpts and answers require at least one mapped block, while a bookmark snapshot may have none. New validated answers preserve their answer-point mapping for saving. A legacy ready session without that mapping may save the whole turn as one block supported by its validated citation union, but cannot offer precise answer-selection saving. The UI may show natural sublabels such as 字幕摘录, 亮点, 摘要, or 回答摘录 without adding more top-level filter kinds.
