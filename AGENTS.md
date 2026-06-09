# Bili-Bill Agent Guide

This repository is worked on by multiple Codex development threads. Follow this guide before changing code or docs.

## Product Positioning

- Bili-Bill is a personal content ledger for local Bilibili consumption, not a replacement for Bilibili search, recommendation, dynamic feed, or creator relationship management.
- Dynamic Bill is for interest rebalancing. Do not describe it as "猜你喜欢", click prediction, or engagement-ranking.
- The AI assistant is a local ledger and knowledge helper. It must explain what evidence it used and fall back to local evidence when AI is unavailable.

## Safety Boundaries

- Do not read, copy, log, or submit local key files, including `C:\Users\LittleNub\Desktop\Key.txt`.
- Do not read or copy Cookie files, browser profiles, Bilibili login-state files, or personal profile files.
- Do not upload full watch history, full favorites, full following lists, full feedback records, full notes, or full local database contents.
- Do not write back to Bilibili relationships or content: no follow/unfollow, favorite-folder edits, comments, likes, coins, or collection mutations.
- Use current browser extension runtime state only when a task explicitly needs logged-in smoke testing. Never extract credentials or session data from disk.

## Language And UX Invariants

- Dynamic Bill status copy is fixed: `未打开 / 已打开 / 已消费 / 已处理`.
- Do not reintroduce `未消费` in `dashboard`, `popup`, `public`, `src`, `README.md`, or new docs.
- If a video has no reliable subtitles, transcript, chapters, or text source, do not claim a full-video summary.
- Current-video assistant answers must label their source tier: metadata summary, description summary, or transcript summary.
- Smart Favorites Q&A answers must cite source videos and explain why each cited video is relevant.
- Video key nodes must have evidence. Do not fabricate timestamps.
- Auto-jump behavior must be disabled by default and require explicit user confirmation.

## Worktree And PR Workflow

- Use one GitHub issue per branch/worktree. Keep PR scope limited to that issue.
- Default branch prefix is `codex/`.
- PRs should be opened as draft. The main agent reviews, requests rework if needed, then marks ready and merges.
- Do not merge PRs, close issues, publish releases, create tags, or change release assets unless the main agent explicitly asks.
- Do not mix PRD/spike docs with implementation in the same PR unless the issue explicitly asks for both.
- Do not revert unrelated changes. If another worktree or user change affects your task, work with it and report the interaction.

## Validation Baseline

Run these before handing work back unless the issue explicitly says docs-only and the main agent relaxes validation:

- `git diff --check`
- `npm run typecheck`
- `npm run build`

For UI changes, also run Browser, Playwright, or a committed/static mock QA flow that covers the changed states. Record any limitation honestly.

The existing Vite large chunk warning for `chunks/theme-*.js` is known build hygiene. Keep recording it as non-blocking unless the task is specifically about bundle size.

## AI Feature Rules

- AI requests must use minimal, intent-specific payloads.
- Payloads must not include full history, full favorites, full following lists, full feedback records, Cookie data, user profile data, local key paths, or unrelated local database rows.
- AI must not decide Dynamic Bill eligibility, ordering, status progression, or feedback suppression unless a future accepted PRD explicitly changes that.
- For current-video help:
  - metadata and description summaries may ship before transcript support.
  - transcript summaries require a reliable transcript source and source labeling.
- For Smart Favorites Q&A:
  - local prefilter/ranking must run before AI.
  - AI may only synthesize an answer from cited videos supplied in the top-N context.
- For Video Knowledge Base:
  - timestamps must come from pages, chapters, transcript spans, or user-saved bookmarks.
  - low-confidence or stale nodes must not be used for auto-jump suggestions.

## Completion Reports

When a delegated development thread finishes, report:

- issue and PR links
- branch and commit
- changed scope
- validation results
- blocker / must-fix / follow-up
- whether the PR is draft/open and unmerged
- whether any local key, Cookie, browser profile, or Bilibili login-state file was read

