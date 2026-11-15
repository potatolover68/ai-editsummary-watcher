# ai-editsummary-watcher

Watches recent changes on English Wikipedia (all namespaces) and scores every
edit summary with the [`ai-editsummary-model`](../ai-editsummary-model)
classifier (`./model.onnx`). Edits scoring **above 0.9** are posted to a
Discord webhook.

Each Discord post includes:
- the page, with a link to the diff;
- the AI score;
- the size change;
- when the edit was made;
- the summary;
- the performer, with their edit count, registration date, and links to their user page, talk page and contribs (as embed links and as link buttons);
- a footer with the bot version, uptime and `$HOSTNAME`, if set.

## Skipped edits

- Edits made with a semi-automated tool listed in
  [MediaWiki:XTools-AutoEdits.json](https://meta.wikimedia.org/wiki/MediaWiki:XTools-AutoEdits.json).
  The rules from `global`, `en` and `en.wikipedia.org` are merged. An edit
  is skipped if its summary matches a tool's `regex`/`revert` pattern, or if
  it carries one of the tool's tags. The list is re-fetched every 6 hours.
- Edits on Wikipedia Adventure pages (`…/TWA/…`). The tutorial writes those
  summaries itself.
- Bot-flagged edits, empty summaries, and summaries or users that have been
  hidden (revision-deleted).

## Setup

Requires Node.js ≥ 22.18, which runs the TypeScript directly with no build
step.

```bash
npm install
cp .env.example .env    # then fill it in
npm start
```

| env var | |
|---|---|
| `DISCORD_WEBHOOK` | webhook URL (required) |
| `BOTUSER` / `BOTPASSWORD` | [bot password](https://en.wikipedia.org/wiki/Special:BotPasswords) login, e.g. `MyBot@watcher`; read-only grants are enough (required) |
| `HOSTNAME` | shown in the footer if set |
| `THRESHOLD` | flag when score > this (default `0.9`) |
| `WIKI` | default `en.wikipedia.org` |
| `POLL_SECONDS` | default `15` |
| `BACKFILL_MINUTES` | also process this many minutes before startup (default `0`) |
| `MODEL_PATH` | default `model.onnx` |
| `DRY_RUN=1` | print messages instead of posting them |

`npm start` loads `.env` if it exists. Plain environment variables work too.
`npm run typecheck` runs `tsc`.

## How it works

1. The bot logs in with the bot password.
2. Every `POLL_SECONDS` it requests
   `list=recentchanges&rctype=edit|new&rcshow=!bot&rcdir=newer`, starting two
   minutes before the newest change it has already seen. Overlapping changes
   are dropped by `rcid`.
3. Summaries are scored in batches with onnxruntime-node on a single thread.
4. For edits above the threshold, the performer's details come from
   `list=users`.
5. Posts are queued and respect Discord's `retry_after`. Link buttons use
   `?with_components=true`; if Discord rejects them, the bot falls back to
   embed links only.

API requests send `maxlag=5` and back off on HTTP 429/5xx.

## Expect false positives

In a 60-minute dry run on en.wikipedia (Nov 2026), about 30 edits scored
above 0.9. Most were good-faith, full-sentence summaries from newer editors,
such as "Added a sentence to the History section and cited". The model was
trained mostly on summaries by experienced editors, so it under-represents
that style. Raise `THRESHOLD` (e.g. to `0.97`) if the channel gets too noisy.
