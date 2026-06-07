# Decouple dynamic sync from AI generation

动态账单 will separate followed-video metadata sync from bill generation and AI explanation. Metadata can refresh relatively often, but AI generation should be low-frequency and batch-oriented to control cost, avoid MV3 service worker interruptions, and keep user-provided AI keys from being consumed by background churn.
