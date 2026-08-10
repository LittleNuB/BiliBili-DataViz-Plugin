---
status: accepted
---

# Preserve legacy favorites without inventing account ownership

Existing favorite folders and items lack the Bilibili account identity needed by the new account-scoped source model, so 0.14 migrates them as 升级前收藏来源 relationships instead of assigning them to the account active during upgrade. Only a later user-authorized and successfully complete favorite sync may replace an exact folder-and-video match with an account-scoped relationship; incomplete syncs and unmatched rows leave legacy data unchanged. This preserves prior source inventory and classification work without fabricating provenance or allowing one account refresh to erase another account's possible history.
