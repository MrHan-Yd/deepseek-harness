# dsh-system-stats

English | [中文](README.zh.md)

Live CPU, memory, and network readings for DeepSeek Harness. Adds one pill under the composer, to the left of the Session statistics, that alternates between two entries of the machine running the Host: CPU and memory together, then the network rates.

## Why this exists

Everything the chat page reports under the composer is about the Session: turns, steps, tokens, cache hits, context use. Nothing reports the machine those numbers are being produced on. This plugin answers that question without leaving the page — whether a slow turn is CPU-bound, whether memory is nearly gone, whether a transfer is moving at all.

The readings describe the **Host** process's machine. A browser on another computer reading `dsh web` over the network sees the Host's figures, not its own.

## What it shows

One pill, two entries alternating every five seconds:

| Entry | In the pill | On click |
|---|---|---|
| CPU and memory | `5% · 61%`, one glyph per figure | The one dialog below |
| 网络 / Network | `685 B/s · 1.2 KB/s`, one arrow per direction | The same dialog |

Clicking opens one dialog for both entries: CPU by name with its core count and sampling window, memory used, available, and total, then both rates. The click never answers a narrower question than the pill asked, so opening it while the rates are showing still reports the CPU and memory figures too.

CPU and memory share an entry because both read as a short percentage; the two rates are long enough to want the entry to themselves. Both entries carry two figures with a glyph each, so they read the same way. The pill shows the figures alone — the glyph names each one — while the accessible name and the dialog state every reading in words.

One box serves both entries, sized to the wider of the two. Each entry is laid out out of sight beside the pill — out of flow, so it cannot move the row, and uncapped, so it reports the width its figures actually need — and the pill takes the wider measurement as its own width. That width only ever grows while the page is open, so neither a rotation nor a burst of traffic can move the row. The narrower entry spends its slack on its own gaps rather than leaving it outside the figures, where the row's own gap would turn it into a hole before the next pill. The figures are never the only way to read them either: hovering or focusing the pill holds the rotation on the entry under the pointer, and clicking opens the same trigger-anchored dialog the Session statistics pills use. The rotation holds while that dialog is open, so its figures stay the ones clicked; Escape or a click outside closes it.

A reading the Host cannot take — a platform with no counter reader, a refused route — renders as `—` rather than as a number. The pill never leaves a previous reading on screen as if it were current.

## Where the figures come from

- **CPU**: two `node:os` `cpus()` readings; the busy share is `1 - idle / total` over the elapsed CPU time of both.
- **Memory**: on macOS `vm_stat`, whose free + inactive + speculative pages are reclaimable while `os.freemem()` would report a machine with a full file cache as nearly out of memory; on Linux `/proc/meminfo`'s `MemAvailable`. Every other platform, and any failed read, falls back to `os.freemem()`.
- **Network**: on macOS `netstat -ibn`, on Linux `/proc/net/dev`, both summed over non-loopback interfaces. Loopback is excluded because a machine talking to itself moves more bytes over `lo` than over every physical interface together.

## What a reading costs

Nothing samples on a timer. The Host reads the machine only when the page asks, at most once per `intervalMs`, and the page polls at the cadence the route reports — so a closed page costs the machine nothing, and two open pages share one sample. Polling pauses while the page is hidden and resumes with an immediate read when it becomes visible again.

The first request after a quiet period has no recent predecessor to subtract, so it re-baselines and measures a 250 ms sweep instead of reporting an average over however long the page was closed.

## Route

`GET /system-stats/api/metrics` answers one JSON reading: `intervalMs`, `at`, `sampledOverMs`, `cpu.percent` and `cpu.cores`, `memory.totalBytes` / `usedBytes` / `percent` / `source`, and `network.receivedBytesPerSecond` / `sentBytesPerSecond` (null where the platform has no reader).

The route goes through the `connection` service's `requestRejection` first — DSH's own Host, Origin, and Fetch-Metadata fence plus browser login-token authentication — and then requires the `x-dsh-system-stats: 1` header, exactly as [`dsh-usage-stats`](../dsh-usage-stats/README.md) does. A missing `connection` service is a refusal, never a pass.

## Configuration

| Key | Range | Default | Meaning |
|---|---|---|---|
| `intervalMs` | 500–60000 | 3000 | Shortest gap between two samples, and the cadence the page polls at |

A value outside the range fails the mount instead of being clamped, so a composition that asks for an unusable cadence is reported rather than quietly corrected.

`cordis.patch.yml` in a profile can override the row's config; restate every key when overriding, because an id-targeted override replaces the whole row.

The pill's own rotation cadence is a display constant, not a sampling choice: the readings refresh on the Host's cadence whether or not the pill has cycled.

## Development

```sh
node --test "plugins/dsh-system-stats/tests/*.test.mjs"
```

`tests/metrics.test.mjs` pins the counter parsers and the difference arithmetic against recorded reports; `tests/host.test.mjs` pins the route's fence, config validation, and one-sample-per-interval contract; `tests/client.test.mjs` renders the pill in jsdom against a stubbed route, including the rotation, the held rotation, the one measured box, and both dialogs.

## Known Limitations and Deferred Work

- Windows has no network reader here, so the network entry is unavailable there; memory falls back to `os.freemem()`.
- The readings are the whole machine's. There is no per-process breakdown, and no disk, temperature, or GPU counter.
- The network figure sums every non-loopback interface, so a VPN tunnel's bytes are counted beside the physical interface carrying them.
- The pill's box is the wider entry's measured width, so a rate longer than anything measured before widens it; the height is fixed, so the row's line never moves.
