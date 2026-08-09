---
status: accepted
---

# Do not promote persistent current-video cache rows

The existing `persistent` field in current-video transcript storage describes cache readability across temporary page ownership, not user-confirmed knowledge admission. Version 14 leaves every such cache row in the bounded current-video tables and promotes none during migration, even when a corresponding favorite creates a canonical video; managed full text still requires a later explicit save or user-driven acquisition boundary and uses separate lifecycle semantics. Cache cleanup may therefore remove these rows without affecting true managed full text, and ordinary UI never labels the internal flag as saved knowledge.
