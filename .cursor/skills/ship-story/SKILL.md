---
name: ship-story
description: Ship a Linear story the repo's way — one commit with KAD-id subject, mark Done, comment SHAs, file Tech Debt for descopes. Use when finishing a story, landing KAD-*, or the user asks to commit and close a Linear issue.
---

# Ship story

Working agreement: direct commits to `main` unless the user asks for a PR. One commit per story.

## Preconditions

1. User explicitly asked to commit (or ship / land the story).
2. Run the `verify-clean` skill first (lint + lint:biome + typecheck + relevant tests).
3. Know the Linear issue id (e.g. `KAD-44`).

## Commit

Follow the user's git commit protocol. Subject shape:

```
KAD-NN: short imperative summary of why
```

Body optional; keep it to motivation / caveats, not a file list.

## Linear (after commit succeeds)

Use the Linear MCP tools (`plugin-linear-linear`):

1. `save_comment` on the issue with the commit SHA(s) and a one-line summary.
2. `save_issue` / state update → **Done** (resolve the Done status id via `list_issue_statuses` if needed).
3. Do this per story as it lands — do not batch to sprint end.

## Descopes

If anything was deliberately skipped or deferred:

1. `create_issue` (or `save_issue`) with the **Tech Debt** label.
2. Body must include: what was left, why out of scope, what breaks, code pointers; name any documenting test.

## Do not

- Push unless the user asked.
- Open a PR unless the user asked.
- Amend unless the user's amend rules are all met.
- Claim Done without the SHA comment.
