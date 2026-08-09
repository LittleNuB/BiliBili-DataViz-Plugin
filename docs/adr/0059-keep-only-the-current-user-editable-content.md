---
status: accepted
---

# Keep only the current user-editable content

Version 14 stores only the current title, user-authored body or note, normalized tags, and creation/update times for an asset's editable user layer. Editing uses explicit save and cancel; a successful save atomically replaces that current layer and does not create a durable revision-history row. Immutable evidence versions and preserved generated wording remain unchanged by user edits. Recovering an older user draft depends on a prior knowledge backup, whose conflicting restore remains a separately labeled imported asset rather than an in-product edit revision. This supersedes the earlier draft interaction that proposed delayed autosave and one post-save undo.
