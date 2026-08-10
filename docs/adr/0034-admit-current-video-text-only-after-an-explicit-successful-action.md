---
status: accepted
---

# Admit current-video text only after an explicit successful action

A synchronized favorite or watch-later relationship may create a lightweight video entry but never bulk-fetches subtitles or starts transcription. Merely opening a video or temporarily obtaining Bilibili subtitles outside the local knowledge space does not persist it. Saving a durable knowledge asset admits the video and retains complete Bilibili subtitle text already available for its exact source. The data contract may also represent a completed local transcript after a future verified capability ships, but 0.14.0 neither exposes nor implements that action; if it ships later, only successful user-confirmed completion may admit the video and transcript, while cancellation or failure creates no knowledge entry. An admitted lightweight video may retain complete text later when the user actually opens it and obtains that text. This preserves explicit acquisition boundaries without turning passive browsing, synchronization, or an unavailable planned feature into hidden collection.
