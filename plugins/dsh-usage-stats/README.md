# dsh-usage-stats

English | [中文](README.zh.md)

Usage statistics for DeepSeek Harness. Adds a **使用统计** page to Settings that folds every Session log in the installation into per-day and per-model token totals, activity streaks, and chat durations.

## Why this exists

DSH reports token usage **per Session**: the chat stats strip and the `tokenUsage` projection both answer "what did this conversation spend". Nothing answers "what has this installation spent, on which days, across which models", which is what the page in the screenshot answers. This plugin reads the same durable events and aggregates them; it adds no new accounting.

## Where the figures come from

The Host half replays each Session's raw log and folds `assistant/message` and `assistant/attempt` settlements. Attribution copies [`@deepseek-ai/dsh-token-meter`](../../packages/llm/token-meter/README.md)'s `tokenUsage` projection, which is the one definition of what a Session spent:

- The model named by the newest preceding `request/context` owns a sample, so a mid-Session model switch attributes the later samples to the new model.
- A sample for an already-settled turn/step **replaces** its predecessor rather than adding to it.
- `llm/retry-started` closes that replacement slot, so the retried attempt adds instead.

Folding anything else would disagree with the per-Session figure the chat page shows. Days are bucketed in the **Host's local timezone**, so a day boundary matches the clock on the machine running `dsh web`.

## The page

| Region | What it shows |
|---|---|
| Five cards | Cumulative tokens, the single highest day, the longest Session span, and the current and longest activity streaks |
| Token 活动 | A 53-week heatmap with 每日 / 每周 / 累计 modes. A cell is lit only for a day that actually spent tokens; the mode chooses the scale — that day, its week, or the running total — so a week used on two days shows two lit cells, never seven. Each tooltip names the day and, off 每日, the scale's total |
| 时间范围 | 近 7 日 / 近 30 日, which drives the trend chart below it |
| 每日 Token 趋势图 | One line per model over the selected range; ranks past six models fold into one 其他 line |
| 模型用量 | A donut of each model's share with its percentage and token count |
| 刷新 | Re-reads the Session corpus, bypassing the memo and the fold cache |

Numbers are formatted with `Intl`, so a Chinese locale writes `3.6亿` and an English one `360M`; switching language reformats without a reload.

## The fold cache

Folding is cached per Session under `$DSH_HOME/usage-stats-cache.json`, keyed by the log file's size and modification time, so a refresh only re-reads Sessions whose logs moved. The cache is a pure optimization: a Session whose log cannot be stat-ed is re-folded every time, `readSession` stays the only read path, and rows for Sessions that no longer exist are dropped on every collect. Deleting the file costs one full fold and changes no figure.

## HTTP API

The page talks to the Host half over same-origin routes under `/usage-stats`. Every request must carry the `x-dsh-usage-stats` header, which a cross-origin page cannot set without a CORS preflight this server never grants.

| Route | Returns |
|---|---|
| `GET /usage-stats/api/summary` | Totals, the per-day buckets, the per-model rows, and one row per Session |
| `GET /usage-stats/api/summary?refresh=1` | The same payload with the five-second memo bypassed |

## Security

Security has one home: the `connection` service's `requestRejection` applies DSH's own Host/Origin/Fetch-Metadata fence — which is what defeats DNS rebinding — plus its browser login-token authentication. A route registered through `ctx.webServer.register` receives neither automatically; only the RPC bridge does. Every request therefore asks for the rejection first, exactly as [`@deepseek-ai/dsh-open-in-app`](../../packages/host/open-in-app/README.md) does. A missing `connection` service is a refusal, never a pass. The guard header stays as a second, cheaper layer.

The page is read-only: no route mutates a Session, a setting, or a file.

## Known limitations

- **Days follow the Host's timezone.** A browser in another timezone sees the Host's day boundaries, not its own.
- **Subagent Sessions are counted.** A delegated child appends its own log, so its spend is part of the installation total rather than of its parent. The Screenshot's sidebar hides those Sessions; the totals here do not.
- **A live Session's newest events may lag.** The cache key is the log file's size and modification time, and a Session that has not flushed since the last collect keeps its previous fold until the next refresh.
- **The fold is a full replay per changed Session.** Cheap at the scale of a personal installation (27 Sessions and 10.7 MB fold in well under a second), but it is O(log size) per refresh, not incremental.

## Tests

`tests/fold.test.mjs` pins the attribution rules against an in-memory Session corpus — model switching, replacement, retry, stream-chunk usage, local-day bucketing, session spans, skipped Sessions, the fold cache's reuse and retention, and the trust fence:

```sh
node --test "plugins/dsh-usage-stats/tests/*.test.mjs"
```

## Install

This fork mounts the plugin in its default web composition: `plugins/*` are pnpm workspace packages, and `packages/bundle/web-app/cordis.patch.yml` inserts the `usage-stats` row, so `pnpm dsh web` serves the page from a checkout with no per-machine install step. Restart the host after changing the plugin: the client half is part of the boot payload generated at server start, so a browser reload alone will not add the page.

The Host half requires the `sessionQuery` service, which `@deepseek-ai/dsh-base` already mounts through `@deepseek-ai/dsh-session-query-sqlite`; the plugin refuses to load without it rather than serving empty figures.

A profile may still install the bundle explicitly. The row id is the same, and the Loader mounts one entry per id, so installing it beside the bundle patch is harmless:

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-usage-stats": "link:/absolute/path/to/deepseek-harness/plugins/dsh-usage-stats"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-usage-stats"]
    }
  }
}
```

Then `pnpm install` in the profile directory and restart `dsh web`.

## Why this lives in `plugins/` and not `packages/`

It is a personal-installation page over a corpus of Sessions, not a capability other packages consume. Nothing exports a service, no package depends on it, and its whole surface is one HTTP route plus one Settings section. `packages/` is for capability seams and shipped composition; a leaf view like this belongs beside the profile that mounts it.
