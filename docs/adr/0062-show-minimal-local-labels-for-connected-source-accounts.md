---
status: accepted
---

# Show minimal local labels for connected source accounts

Account-scoped source synchronization stores only the account identifier and nickname returned during a user-initiated authorized sync; it never reads Cookie files, login-state files, browser profiles, or local key files. 收藏来源 shows the nickname only, falling back to a stable local alias such as “已连接账号 1”; it does not display the UID, retain an avatar, or build an account profile. The identifier and label remain inside the synchronized-source lifecycle and are excluded from knowledge backup, diagnostic export, and AI requests. A newly detected account requires confirmation before import, and disconnecting one account removes only its source relationships while preserving canonical videos, knowledge assets, evidence, and managed full text.
