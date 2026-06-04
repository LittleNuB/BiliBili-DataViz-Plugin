# API-first dynamic bill ingestion

动态账单 will ingest followed video-submission updates through Bilibili API responses first, persist them locally, and use DOM extraction only as a fallback path. This matches Bili-Bill's existing background API, IndexedDB, and Dashboard workflow, while avoiding a first-version dependency on the native Bilibili dynamic page's DOM structure.
