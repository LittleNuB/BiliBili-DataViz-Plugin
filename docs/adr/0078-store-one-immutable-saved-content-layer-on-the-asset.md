---
status: accepted
amended-by: 0079
amends: 0043
---

# Store one immutable saved-content layer on the asset

A `knowledgeAssets` row may own one immutable saved-content layer containing its content kind, preserved body blocks, and the originating question for a saved answer or answer excerpt as refined by ADR 0079. This stores a selected answer, whole saved answer, summary, highlight, or other explicitly preserved generated wording once even when several asset-source relations support it. The editable title, personal note, tags, and pure-note body remain a distinct current user layer; saved content cannot be edited in place and a rewrite is saved separately as a personal note. Each `knowledgeEvidenceVersions` row retains only its exact source excerpt, video, part, time range, source identity, and mapping back to the asset-level saved content. Source relocation changes that relation's evidence selection without rewriting the preserved result. Provider, model, prompt, confidence, and other raw generation fields are excluded, while the immutable saved content is included with its asset in backup.
