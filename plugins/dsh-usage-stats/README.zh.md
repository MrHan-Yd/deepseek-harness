# dsh-usage-stats

[English](README.md) | 中文

DeepSeek Harness 的使用统计。在「设置」里加一页 **使用统计**，把本机所有会话日志折算成按天、按模型的 Token 总量、活跃连续天数与聊天时长。

## 为什么需要它

DSH 的用量是**按会话**报的：对话页的统计条和 `tokenUsage` 投影回答的都是「这段对话花了多少」。没有任何地方回答「这台机器一共花了多少、花在哪几天、分给了哪些模型」，而这正是截图里那一页要回答的。本插件读的是同一批持久事件并做聚合，没有引入任何新的计量口径。

## 数字从哪来

宿主侧把每个会话的原始日志重放一遍，折算 `assistant/message` 与 `assistant/attempt` 的结算。归属规则照抄 [`@deepseek-ai/dsh-token-meter`](../../packages/llm/token-meter/README.zh.md) 的 `tokenUsage` 投影——那是「一个会话花了多少」的唯一权威定义：

- 样本归属于它**之前最近一次** `request/context` 点名的模型；会话中途换模型，之后的样本就记到新模型上。
- 同一个已结算的 turn/step 再次上报，是**替换**前一条，而不是累加。
- `llm/retry-started` 会关掉这个替换槽，因此重试那一次是**累加**。

换一种折法，就会和对话页显示的每会话数字对不上。日期按**宿主本地时区**分桶，所以天的边界就是运行 `dsh web` 那台机器的时钟。

## 页面

| 区域 | 内容 |
|---|---|
| 五张卡片 | 累计 Token 数、单日最高、最长会话跨度、当前与最长连续天数 |
| Token 活动 | 53 周热力图，支持 每日 / 每周 / 累计 三种口径。**只有真正产生过消耗的那一天才会点亮**；口径决定的是颜色刻度——当天、当周、还是累计——所以一周里只用了两天就只亮两格，不会是七格。悬停显示当天日期，非「每日」时还显示该口径的总量 |
| 时间范围 | 近 7 日 / 近 30 日，决定下方趋势图的范围 |
| 每日 Token 趋势图 | 选定范围内每个模型一条线；排名前六之外的模型合并成一条「其他」 |
| 模型用量 | 环形图展示各模型占比，并列出百分比与 Token 数 |
| 刷新 | 重新读取会话语料，同时绕过记忆化与折算缓存 |

数字用 `Intl` 格式化，所以中文写出 `3.6亿` 而英文写 `360M`；切换语言即刻重新格式化，无需刷新。

## 折算缓存

折算结果按会话缓存在 `$DSH_HOME/usage-stats-cache.json`，键是日志文件的大小与修改时间，因此刷新时只会重读日志发生过变化的会话。缓存是纯优化：取不到 stat 的会话每次都重新折算，`readSession` 始终是唯一的读取路径，每次收集都会丢弃已不存在会话的行。删掉这个文件只会多花一次全量折算的时间，不会改变任何数字。

## HTTP API

页面通过同源路由 `/usage-stats` 与宿主侧通信。每个请求都必须带 `x-dsh-usage-stats` 头，跨源页面在没有本服务永远不会授予的 CORS 预检时无法设置它。

| 路由 | 返回 |
|---|---|
| `GET /usage-stats/api/summary` | 合计、按天分桶、按模型行，以及每个会话一行 |
| `GET /usage-stats/api/summary?refresh=1` | 同样的载荷，但绕过五秒记忆化 |

## 安全

安全只有一处：`connection` 服务的 `requestRejection` 会施加 DSH 自己的 Host/Origin/Fetch-Metadata 防线（这正是防 DNS rebinding 的那道）以及浏览器登录令牌鉴权。通过 `ctx.webServer.register` 注册的路由不会自动获得这两者，只有 RPC 桥才有。因此每个请求都先问一次拒绝结果，做法与 [`@deepseek-ai/dsh-open-in-app`](../../packages/host/open-in-app/README.zh.md) 完全一致。取不到 `connection` 服务即视为拒绝，绝不放行。守卫头只是第二层更廉价的防线。

页面是只读的：没有任何路由会改动会话、设置或文件。

## 已知限制

- **日期按宿主时区。** 处在其他时区的浏览器看到的是宿主的日界，不是它自己的。
- **子智能体会话也计入。** 被委派的子会话会写自己的日志，因此它的消耗算进整机总量，而不是算进父会话。截图里的侧边栏会隐藏这些会话，而这里的合计不会。
- **活跃会话的最新事件可能滞后。** 缓存键是日志文件的大小与修改时间，上次收集之后还没落盘的会话会保留上一次的折算结果，直到下次刷新。
- **每个变动的会话都要完整重放一遍。** 在个人安装的规模上很便宜（27 个会话、10.7 MB 折算远不到一秒），但它是每次刷新 O(日志大小)，不是增量的。

## 测试

`tests/fold.test.mjs` 用一份内存中的会话语料固定住归属规则——模型切换、替换、重试、stream 分片里的 usage、本地日期分桶、会话跨度、跳过的会话、折算缓存的复用与回收，以及信任防线：

```sh
node --test "plugins/dsh-usage-stats/tests/*.test.mjs"
```

## 安装

本 fork 把它挂进了默认的 Web 组合：`plugins/*` 是 pnpm workspace 包，`packages/bundle/web-app/cordis.patch.yml` 插入了 `usage-stats` 那一行，所以从检出目录直接 `pnpm dsh web` 就有这个页面，不需要在每台机器上各装一次。改动插件后要重启宿主：浏览器那一半属于服务启动时生成的 boot payload，只刷新浏览器不会加上这个页面。

宿主侧依赖 `sessionQuery` 服务，而 `@deepseek-ai/dsh-base` 已经通过 `@deepseek-ai/dsh-session-query-sqlite` 挂载了它；取不到时插件会拒绝加载，而不是端出一堆空数字。

profile 也仍然可以显式安装这个 bundle。行 id 相同，而 Loader 对每个 id 只挂载一个条目，所以和 bundle patch 一起装上没有副作用：

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

然后在 profile 目录里 `pnpm install` 并重启 `dsh web`。

## 为什么它放在 `plugins/` 而不是 `packages/`

它是架在会话语料之上的一个个人安装页面，不是别的包会消费的能力。它不导出任何服务，没有任何包依赖它，全部对外面貌就是一条 HTTP 路由加一个「设置」分区。`packages/` 留给能力接缝和随包发布的组合；像这样的一片叶子视图，应当待在挂载它的 profile 旁边。
