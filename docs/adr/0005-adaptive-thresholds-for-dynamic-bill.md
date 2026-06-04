# Adaptive thresholds for dynamic bill columns

动态账单 will use adaptive thresholds based on each user's local watch distribution, with small fixed floors to avoid one-off noise. Fixed global thresholds would overfit either heavy or light Bilibili users, while adaptive thresholds let columns such as 久违更新 and 换换口味 stay meaningful across different consumption volumes.
