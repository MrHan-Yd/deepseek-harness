/**
 * dsh-mcp-scope browser half: the Settings page for workspace-scoped MCP servers.
 *
 * Shipped as a Dynamic Client bundle without a build step: the factory takes
 * `react` and the shared `@deepseek-ai/dsh-client-ui-primitives` from the
 * platform module table and builds every element with `createElement`, so the
 * file in `src/` is the file a reviewer reads. Other icons are inline SVG for
 * the same reason: the bundle resolves nothing else.
 *
 * The page talks to the host half over the same-origin `/mcp-scope/api` routes
 * and always sends the `x-dsh-mcp-scope` header the host requires.
 *
 * @module dsh-mcp-scope/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-scope',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    // The dropdown trigger's chevron and list, and the row's delete glyph, come
    // from the shared primitives: `Menu` is the control every other Settings row
    // opens, and its trash is the same icon the Models page deletes a model
    // with. The module table seeds the package for dynamic bundles, so no build
    // step or manifest entry is needed to reach it.
    const { IconChevronDownOutlineRegular, IconTrashOutlineRegular, Menu } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.mcpScope'

    const zh = {
      nav: 'MCP 服务器',
      title: 'MCP 服务器',
      count: 'MCP 服务器',
      search: '搜索 MCP 服务器…',
      global: '全局',
      workspace: '工作区',
      installed: '已安装',
      items: '项',
      newServer: '新建',
      reload: '刷新',
      empty: '还没有配置任何 MCP 服务器。',
      emptyFiltered: '没有匹配的 MCP 服务器。',
      enabled: '已启用',
      disabled: '已停用',
      mountFailed: '装载失败',
      connected: '已连接',
      connecting: '连接中…',
      pageCheck: '页面检查',
      edit: '编辑',
      remove: '删除',
      confirmRemove: '确认删除',
      createTitle: '新建 MCP 服务器',
      editTitle: '编辑 MCP 服务器',
      createHint: '填写新的 MCP 配置，保存后返回列表。',
      editHint: '修改配置并保存。名称不可更改。',
      fieldName: '名称',
      fieldNameHint: '1–32 位字母、数字、下划线或连字符',
      fieldScope: '作用域',
      fieldTransport: '类型',
      modeForm: '表单',
      modeJson: 'JSON',
      jsonHint: '粘贴一份配置：{"名称": {"type": "stdio", "command": "…", "args": ["…"]}}（也兼容外层再包一层 "mcpServers" 的写法）。',
      jsonEditHint: '按已存的配置生成；env/headers 只列键名，值留空表示保持原值，名称不可更改。',
      jsonNameFixed: '名称不可更改：粘贴里的名称必须仍是 {name}。',
      jsonPreview: '解析成功',
      jsonEmpty: '先粘贴一份服务器配置。',
      jsonInvalid: 'JSON 解析失败',
      jsonObject: '配置必须是一个对象。',
      jsonServers: '配置必须是一个「名称 → 服务器」的对象。',
      jsonServersEmpty: '配置里没有服务器。',
      jsonServersMultiple: '配置里有多个服务器；一次只能添加一个。',
      jsonServerObject: '每个服务器配置必须是一个对象。',
      jsonNameMissing: '缺少服务器名称：用外层对象的键，或在配置里写 "name"。',
      jsonTransport: '不支持的类型 "{type}"：这里只支持 stdio 和 streamable-http。',
      jsonCommandMissing: 'stdio 服务器缺少 "command"。',
      jsonUrlMissing: '远程服务器缺少以 http:// 或 https:// 开头的 "url"。',
      jsonArgs: '"args" 必须是数组。',
      jsonMapObject: '"{field}" 必须是一个对象。',
      jsonMapKey: '"{field}" 的键不能为空。',
      jsonMapValue: '"{field}.{key}" 必须是字符串（数字和布尔值会转成字符串）。',
      fieldTimeout: '超时时间 MS',
      fieldCommand: '命令',
      fieldArgs: '参数（空格分隔）',
      secretHint: '值留空表示保持原值 —— 凭据不会回传到这个页面',
      fieldEnv: '环境变量（可选，每行 KEY=VALUE）',
      fieldUrl: 'URL',
      fieldHeaders: 'Headers（可选，每行 KEY: VALUE）',
      fieldReadOnly: '只读（只放行查询类工具）',
      readOnlyHint: '所有 MCP 服务器默认只读：工具名能证明是查询的才放行，写操作一律不暴露给模型。',
      readOnlyBadge: '只读',
      readOnlyOpen: '可写',
      readOnlyOpenHint: '这个服务器放开了只读限制，写操作会暴露给模型。',
      withheldTools: '已拦截 {count} 个非只读工具',
      withheldHint: '只读策略按工具名判定：带写动词、或无法判定为查询的工具都不会暴露给模型。',
      transportStdio: 'stdio（本地命令）',
      transportHttp: 'streamable-http（远程地址）',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      loading: '加载中…',
      sessions: '个会话可见',
      probe: '探测',
      probing: '探测中…',
      reachable: '可达',
      unreachable: '不可达',
      scopeHint: '选择该服务器在哪些会话中可见。',
      errorPrefix: '操作失败',
      commandConflict: '命令名冲突',
      commandConflictHint: '已有同名命令，这个服务器的 / 命令会遮蔽它',
      storeAt: '配置存储',
      footerHint: '作用域为「全局」的服务器对所有会话可见；作用域为某个工作区的只在该工作区的会话中可见。',
    }

    const en = {
      nav: 'MCP servers',
      title: 'MCP servers',
      count: 'MCP servers',
      search: 'Search MCP servers…',
      global: 'Global',
      workspace: 'Workspace',
      installed: 'Installed',
      items: '',
      newServer: 'New',
      reload: 'Refresh',
      empty: 'No MCP servers configured yet.',
      emptyFiltered: 'No MCP server matches.',
      enabled: 'Enabled',
      disabled: 'Disabled',
      mountFailed: 'Mount failed',
      connected: 'Connected',
      connecting: 'Connecting…',
      pageCheck: 'page check',
      edit: 'Edit',
      remove: 'Delete',
      confirmRemove: 'Confirm delete',
      createTitle: 'New MCP server',
      editTitle: 'Edit MCP server',
      createHint: 'Fill in the new MCP configuration; saving returns to the list.',
      editHint: 'Change the configuration and save. The name cannot change.',
      fieldName: 'Name',
      fieldNameHint: '1–32 letters, digits, underscores, or hyphens',
      fieldScope: 'Scope',
      fieldTransport: 'Transport',
      modeForm: 'Form',
      modeJson: 'JSON',
      jsonHint: 'Paste a configuration: {"name": {"type": "stdio", "command": "…", "args": ["…"]}}. A configuration wrapped in "mcpServers" is accepted too.',
      jsonEditHint: 'Built from the stored configuration; env/headers list key names only, a blank value keeps the stored one, and the name cannot change.',
      jsonNameFixed: 'The name cannot change: the pasted configuration must still be named {name}.',
      jsonPreview: 'Parsed',
      jsonEmpty: 'Paste a server configuration first.',
      jsonInvalid: 'JSON could not be parsed',
      jsonObject: 'The configuration must be an object.',
      jsonServers: 'The configuration must be a name → server object.',
      jsonServersEmpty: 'The configuration holds no server.',
      jsonServersMultiple: 'The configuration holds more than one server; add one at a time.',
      jsonServerObject: 'Each server configuration must be an object.',
      jsonNameMissing: 'No server name: use the outer key, or write "name" in the configuration.',
      jsonTransport: 'Transport "{type}" is not supported here; use stdio or streamable-http.',
      jsonCommandMissing: 'A stdio server needs "command".',
      jsonUrlMissing: 'A remote server needs a "url" starting with http:// or https://.',
      jsonArgs: '"args" must be an array.',
      jsonMapObject: '"{field}" must be an object.',
      jsonMapKey: '"{field}" keys must not be empty.',
      jsonMapValue: '"{field}.{key}" must be a string (numbers and booleans are converted).',
      fieldTimeout: 'Timeout ms',
      fieldCommand: 'Command',
      fieldArgs: 'Arguments (space separated)',
      secretHint: 'A blank value keeps the stored one — credentials are never sent to this page',
      fieldEnv: 'Environment (optional, one KEY=VALUE per line)',
      fieldUrl: 'URL',
      fieldHeaders: 'Headers (optional, one KEY: VALUE per line)',
      fieldReadOnly: 'Read-only (query-shaped tools only)',
      readOnlyHint: 'Every MCP server is read-only by default: only a tool whose name proves a read is exposed, and writes never reach the model.',
      readOnlyBadge: 'Read-only',
      readOnlyOpen: 'Writable',
      readOnlyOpenHint: 'This server waives the read-only policy, so its write tools reach the model.',
      withheldTools: '{count} non-read tools withheld',
      withheldHint: 'The policy judges by tool name: a write verb, or no provable read, keeps a tool away from the model.',
      transportStdio: 'stdio (local command)',
      transportHttp: 'streamable-http (remote URL)',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      loading: 'Loading…',
      sessions: 'live sessions',
      probe: 'Probe',
      probing: 'Probing…',
      reachable: 'Reachable',
      unreachable: 'Unreachable',
      scopeHint: 'Choose which sessions can see this server.',
      errorPrefix: 'Failed',
      commandConflict: 'Command name taken',
      commandConflictHint: 'Another command already uses this name, so this server’s / command shadows it',
      storeAt: 'Config store',
      footerHint: 'A server scoped to Global is visible to every session; one scoped to one workspace is visible only to sessions running in it.',
    }

    /** Tokens shared by every control; neutral so both themes render. */
    const border = '1px solid color-mix(in srgb, currentColor 18%, transparent)'
    const softBorder = '1px solid color-mix(in srgb, currentColor 12%, transparent)'
    const subtle = 'color-mix(in srgb, currentColor 6%, transparent)'
    const fieldStyle = {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
      border, background: subtle, color: 'inherit', font: 'inherit', outline: 'none',
    }
    const buttonStyle = {
      padding: '7px 14px', borderRadius: 8, border, background: subtle,
      color: 'inherit', font: 'inherit', cursor: 'pointer',
    }
    const iconButtonStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      width: 32, height: 32, padding: 0, borderRadius: 8, border, background: 'transparent',
      color: 'inherit', cursor: 'pointer',
    }
    // A label-free affordance inside a row: no box of its own, painted only
    // while the pointer is on it, the shape the Models page rows use.
    const bareIconButtonStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      width: 28, height: 28, padding: 0, borderRadius: 6, border: 'none',
      background: 'transparent', color: 'inherit', cursor: 'pointer',
    }
    const chipStyle = {
      fontSize: 11, padding: '2px 8px', borderRadius: 6, border: softBorder,
      opacity: 0.75, whiteSpace: 'nowrap',
    }
    const selectStyle = {
      ...fieldStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, textAlign: 'left', cursor: 'pointer',
    }

    /**
     * One inline SVG glyph.
     * @param props - the glyph props.
     * @returns the svg element.
     */
    function Glyph(props) {
      return h('svg', {
        width: props.size ?? 16,
        height: props.size ?? 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: props.weight ?? 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { flexShrink: 0, display: 'block' },
        'aria-hidden': true,
      }, h('path', { d: props.d }))
    }

    const PlugGlyph = (props) => h(Glyph, {
      ...props,
      d: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4',
    })
    const SearchGlyph = (props) => h(Glyph, { ...props, d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3' })
    const RefreshGlyph = (props) => h(Glyph, { ...props, d: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6' })
    const PlusGlyph = (props) => h(Glyph, { ...props, d: 'M12 5v14M5 12h14' })
    const ScreenGlyph = (props) => h(Glyph, { ...props, d: 'M3 5h18v11H3zM9 20h6M12 16v4' })
    const WaveGlyph = (props) => h(Glyph, { ...props, d: 'M3 12h3l2.5-6 4 12 2.5-6h6' })

    /**
     * One request against the host half.
     * @param method - HTTP method.
     * @param path - route below the API prefix.
     * @param body - optional JSON body.
     * @returns the decoded response body.
     */
    async function request(method, path, body) {
      const response = await fetch(`/mcp-scope/api${path}`, {
        method,
        headers: body === undefined
          ? { 'x-dsh-mcp-scope': '1' }
          : { 'x-dsh-mcp-scope': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const decoded = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (decoded?.ok !== true) throw new Error(decoded?.error ?? `HTTP ${response.status}`)
      return decoded
    }

    /**
     * Render one labelled field.
     * @param props - label, hint, and the control.
     * @returns the field element.
     */
    function Field(props) {
      const kind = props.as ?? 'label'
      return h(kind, { style: { display: 'block', marginBottom: 14, minWidth: 0 } },
        h('div', { style: { fontSize: 12, opacity: 0.75, marginBottom: 5 } }, props.label),
        props.children,
        props.hint === undefined
          ? null
          : h('div', { style: { fontSize: 11, opacity: 0.5, marginTop: 4 } }, props.hint))
    }

    /**
     * One dropdown: the shared `Menu` primitive opened from a pill trigger.
     *
     * This replaces the native `<select>` the page used to render. A native
     * popup is drawn by the operating system from its own palette and cannot
     * follow the application theme, so a dark-theme row came out as white text
     * on the highlighted light row and the options could not be read. `Menu`
     * is the control the rest of the Settings surface uses — every dropdown
     * row in 通用设置 opens this one — so the page matches them, in both
     * themes, and keyboard traversal and outside-click dismissal come with it.
     *
     * @param props - options, current value, change handler, styling, labels, and an optional leading icon.
     * @returns the dropdown element.
     */
    function Select(props) {
      const [open, setOpen] = useState(false)
      const options = props.options ?? []
      const selected = options.find(option => option.value === props.value)
      const dropdown = h(Menu, {
        open,
        onClose: () => { setOpen(false) },
        items: options.map(option => ({ id: option.value, label: option.label })),
        selectedId: props.value,
        onSelect: (value) => {
          setOpen(false)
          props.onChange(value)
        },
        align: props.align ?? 'start',
        // Both hosts clip their own overflow — the Settings dialog scrolls its
        // body and the list is taller than the row it hangs from.
        portal: true,
        anchor: h('button', {
          type: 'button',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': props.ariaLabel,
          disabled: props.disabled === true,
          onClick: () => { setOpen(current => !current) },
          style: { ...selectStyle, ...props.style },
        },
          props.icon === undefined
            ? null
            : h('span', { style: { display: 'flex', opacity: 0.7, flexShrink: 0 } }, props.icon),
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            selected === undefined ? props.placeholder ?? '' : selected.label),
          h('span', { style: { display: 'flex', flexShrink: 0 } }, h(IconChevronDownOutlineRegular))),
      })
      // `Menu` wraps its anchor in an inline-flex pill, so a block-level
      // dropdown stretches that wrapper through a column flex container
      // instead of a width rule the wrapper would ignore.
      return props.block === true
        ? h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, dropdown)
        : dropdown
    }

    /**
     * Render the switch used by the enable toggle.
     * @param props - checked state, tooltip, and change handler.
     * @returns the switch element.
     */
    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked,
        title: props.title,
        onClick: (event) => {
          event.stopPropagation()
          props.onChange(!props.checked)
        },
        style: {
          width: 40, height: 22, borderRadius: 999, border, cursor: 'pointer', padding: 2,
          background: props.checked ? '#4f7cf7' : subtle,
          display: 'flex', alignItems: 'center', flexShrink: 0,
          justifyContent: props.checked ? 'flex-end' : 'flex-start',
          transition: 'background 120ms ease',
        },
      }, h('span', {
        style: {
          width: 16, height: 16, borderRadius: 999, background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.35)',
        },
      }))
    }

    /**
     * The tile that stands in for a server's avatar.
     * @param props - the glyph to show, plus the status dot's color and label.
     * @returns the tile element.
     */
    function Tile(props) {
      return h('div', {
        style: {
          position: 'relative', width: 42, height: 42, borderRadius: 11, border,
          background: subtle, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, opacity: 0.9,
        },
      },
      props.children,
      // The status dot: its color is the whole row's connection state, and the
      // words that state stands for are its tooltip and accessible name.
      props.badge === undefined
        ? null
        : h('span', {
          role: 'img',
          'aria-label': props.badgeLabel,
          title: props.badgeLabel,
          style: {
            position: 'absolute', right: 3, bottom: 3, width: 10, height: 10, borderRadius: 999,
            background: props.badge,
          },
        }))
    }

    /**
     * Parse KEY=VALUE lines into a map.
     * @param text - the textarea contents.
     * @param separator - the assignment marker.
     * @returns the parsed map.
     */
    function parsePairs(text, separator) {
      const result = {}
      for (const rawLine of String(text ?? '').split('\n')) {
        const line = rawLine.trim()
        if (line === '') continue
        const at = line.indexOf(separator)
        if (at <= 0) continue
        const key = line.slice(0, at).trim()
        const value = line.slice(at + separator.length).trim()
        if (key !== '') result[key] = value
      }
      return result
    }

    /**
     * Render a map as editable lines.
     * @param map - the map to render.
     * @param separator - the assignment marker.
     * @returns the textarea contents.
     */
    function formatPairs(map, separator) {
      return Object.entries(map ?? {}).map(([key, value]) => `${key}${separator}${value}`).join('\n')
    }

    /**
     * Render key names as lines carrying empty values.
     *
     * The host withholds credential values, so the page learns only the key
     * names. A key submitted with an empty value keeps its stored value.
     *
     * @param keys - the key names.
     * @param separator - the assignment marker.
     * @returns the textarea contents.
     */
    function formatKeys(keys, separator) {
      return (keys ?? []).map(key => `${key}${separator}`).join('\n')
    }

    /** Transport names a pasted configuration may use, normalized to this plugin's two. */
    const JSON_TRANSPORTS = {
      stdio: 'stdio',
      http: 'streamable-http',
      remote: 'streamable-http',
      'streamable-http': 'streamable-http',
      streamable_http: 'streamable-http',
      streamablehttp: 'streamable-http',
    }

    /** A sample a person can paste, shaped like the configs other MCP clients document. */
    const JSON_PLACEHOLDER = `{
  "memory": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"],
    "env": { "MEMORY_FILE_PATH": "/tmp/memory.json" }
  }
}`

    /** Top-level fields that belong to a server, not to a name → server map. */
    const JSON_SERVER_FIELDS = [
      'command', 'args', 'env', 'cwd', 'url', 'headers', 'name', 'serverName', 'type', 'transport',
    ]

    /**
     * Read one object field as a string map.
     *
     * Numbers and booleans are converted, because documented MCP configurations
     * routinely spell a port or a flag that way; anything else is a mistake the
     * paste should hear about rather than have silently dropped.
     *
     * @param value - the candidate field.
     * @param field - field name, for the message.
     * @param t - the bound dictionary.
     * @returns the map, or the message to show.
     */
    function jsonStringMap(value, field, t) {
      if (value === undefined || value === null) return { map: {} }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { error: t('jsonMapObject').replace('{field}', field) }
      }
      const map = {}
      for (const [key, entry] of Object.entries(value)) {
        if (key.trim() === '') return { error: t('jsonMapKey').replace('{field}', field) }
        if (typeof entry === 'string') {
          map[key] = entry
          continue
        }
        if (typeof entry === 'number' || typeof entry === 'boolean') {
          map[key] = String(entry)
          continue
        }
        return { error: t('jsonMapValue').replace('{field}', field).replace('{key}', key) }
      }
      return { map }
    }

    /**
     * Parse one pasted MCP server configuration into the record the Host stores.
     *
     * Both shapes people actually copy are accepted: a map of server name to
     * server configuration — `{"name": {"type": "stdio", "command": …}}`, the
     * shape the other MCP clients in use here write — and that same map under
     * an `mcpServers` wrapper. One server object on its own is accepted too.
     * The Host remains the validator — this only has to name what it cannot
     * read before the request is sent.
     *
     * @param text - the textarea contents.
     * @param t - the bound dictionary.
     * @returns the parsed server, or the message to show.
     */
    function parseServerJson(text, t) {
      const trimmed = String(text ?? '').trim()
      if (trimmed === '') return { error: t('jsonEmpty') }
      let parsed
      try {
        parsed = JSON.parse(trimmed)
      } catch (error) {
        return { error: `${t('jsonInvalid')}：${error instanceof Error ? error.message : String(error)}` }
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: t('jsonObject') }

      // A top-level field only a server has means the object IS the server;
      // otherwise the object is the name → server map.
      const isServer = JSON_SERVER_FIELDS.some(field => parsed[field] !== undefined)
      const servers = parsed.mcpServers !== undefined
        ? parsed.mcpServers
        : isServer ? undefined : parsed

      let name = ''
      let spec = parsed
      if (servers !== undefined) {
        if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return { error: t('jsonServers') }
        const names = Object.keys(servers)
        if (names.length === 0) return { error: t('jsonServersEmpty') }
        if (names.length > 1) return { error: t('jsonServersMultiple') }
        name = names[0]
        spec = servers[name]
        if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return { error: t('jsonServerObject') }
      }

      // In the map the key names the server; a bare object names it itself.
      const serverName = String(name !== '' ? name : (spec.serverName ?? spec.name ?? '')).trim()
      if (serverName === '') return { error: t('jsonNameMissing') }

      const url = typeof spec.url === 'string' ? spec.url.trim() : ''
      const declared = spec.transport ?? spec.type
      const transport = declared === undefined
        ? (url === '' ? 'stdio' : 'streamable-http')
        : JSON_TRANSPORTS[String(declared).toLowerCase()]
      if (transport === undefined) return { error: t('jsonTransport').replace('{type}', String(declared)) }

      const timeout = Number(spec.toolCallTimeoutMs)
      const server = {
        serverName,
        transport,
        enabled: spec.enabled !== false,
        toolCallTimeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 30000,
      }
      if (transport === 'stdio') {
        const command = typeof spec.command === 'string' ? spec.command.trim() : ''
        if (command === '') return { error: t('jsonCommandMissing') }
        const args = spec.args ?? []
        if (!Array.isArray(args)) return { error: t('jsonArgs') }
        const env = jsonStringMap(spec.env, 'env', t)
        if (env.error !== undefined) return { error: env.error }
        server.command = command
        server.args = args.map(String)
        server.env = env.map
        // Reported only when the paste names it: an edit keeps the stored
        // working directory, which the form no longer shows, and an explicit
        // empty string still clears it.
        if (typeof spec.cwd === 'string') server.cwd = spec.cwd.trim()
      } else {
        if (!/^https?:\/\//u.test(url)) return { error: t('jsonUrlMissing') }
        const headers = jsonStringMap(spec.headers, 'headers', t)
        if (headers.error !== undefined) return { error: headers.error }
        server.url = url
        server.headers = headers.map
      }
      // A scope written in the paste seeds the selector that decides the final
      // value; the visible control stays authoritative.
      if (typeof spec.scope === 'string' && spec.scope.trim() !== '') server.scope = spec.scope.trim()
      return { server }
    }

    /**
     * The create/edit form.
     * @param props - form props.
     * @returns the form element.
     */
    function ServerForm(props) {
      const { t, workspaces, defaultScope, initial, onSubmit, onCancel } = props
      const editing = initial !== undefined
      const [name, setName] = useState(initial?.serverName ?? '')
      const [scope, setScope] = useState(initial?.scope ?? defaultScope ?? 'global')
      const [transport, setTransport] = useState(initial?.transport ?? 'stdio')
      const [timeout, setTimeoutMs] = useState(String(initial?.toolCallTimeoutMs ?? 30000))
      const [command, setCommand] = useState(initial?.command ?? '')
      const [args, setArgs] = useState((initial?.args ?? []).join(' '))
      // No editor field: the scope above decides visibility, a stored working
      // directory survives an edit, and JSON mode is where a new one is set.
      const cwd = initial?.cwd ?? ''
      const [env, setEnv] = useState(formatKeys(initial?.envKeys, '='))
      const [url, setUrl] = useState(initial?.url ?? '')
      const [headers, setHeaders] = useState(formatKeys(initial?.headerKeys, ':'))
      // The Host defaults an absent field to read-only, so only the stored
      // `false` reaches this control in the open position.
      const [readOnly, setReadOnly] = useState(initial?.readOnly !== false)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState('')
      const [mode, setMode] = useState('form')
      const [jsonText, setJsonText] = useState('')

      /**
       * The stored record as the edit tab's starting point.
       *
       * Credential values never reach this page, so each stored key is listed
       * with a blank value: the Host keeps a stored value for a key submitted
       * blank, which makes the template a safe thing to edit and save.
       *
       * @returns the template text, or '' when there is no stored record.
       */
      const jsonTemplate = () => {
        if (!editing) return ''
        const spec = { type: initial.transport }
        if (initial.transport === 'stdio') {
          spec.command = initial.command ?? ''
          spec.args = [...(initial.args ?? [])]
          if ((initial.cwd ?? '') !== '') spec.cwd = initial.cwd
          if ((initial.envKeys ?? []).length > 0) {
            spec.env = Object.fromEntries((initial.envKeys ?? []).map(key => [key, '']))
          }
        } else {
          spec.url = initial.url ?? ''
          if ((initial.headerKeys ?? []).length > 0) {
            spec.headers = Object.fromEntries((initial.headerKeys ?? []).map(key => [key, '']))
          }
        }
        if ((initial.toolCallTimeoutMs ?? 30000) !== 30000) spec.toolCallTimeoutMs = initial.toolCallTimeoutMs
        if (initial.enabled === false) spec.enabled = false
        if (initial.readOnly === false) spec.readOnly = false
        return JSON.stringify({ [initial.serverName]: spec }, undefined, 2)
      }

      /**
       * Add every stored key the paste left out, blank.
       *
       * `mergeSecrets` keeps a stored value for a key submitted blank and drops
       * a key that is absent, so an edit must name every key this page cannot
       * render a value for.
       *
       * @param map - the paste's map.
       * @param storedKeys - key names the stored record holds.
       * @returns the map with the missing keys added blank.
       */
      const withStoredKeys = (map, storedKeys) => {
        const result = { ...map }
        for (const key of storedKeys ?? []) {
          if (result[key] === undefined) result[key] = ''
        }
        return result
      }

      const submit = async () => {
        setBusy(true)
        setFailure('')
        try {
          if (mode === 'json') {
            // The selector is the visible control, so it owns the scope, and
            // the parse only reports what it cannot read.
            if (jsonProblem !== undefined) {
              setFailure(jsonProblem)
              return
            }
            const server = { ...json.server, scope }
            if (editing) {
              if (server.transport === 'stdio') {
                server.env = withStoredKeys(server.env, initial.envKeys)
                server.cwd = server.cwd ?? initial.cwd ?? ''
              } else {
                server.headers = withStoredKeys(server.headers, initial.headerKeys)
              }
            } else if (server.transport === 'stdio') {
              server.cwd = server.cwd ?? ''
            }
            await onSubmit(server)
            return
          }
          const server = {
            serverName: name.trim(),
            scope,
            transport,
            toolCallTimeoutMs: Number(timeout) || 30000,
            enabled: initial?.enabled !== false,
            readOnly,
          }
          if (transport === 'stdio') {
            server.command = command.trim()
            server.args = args.split(/\s+/u).map(part => part.trim()).filter(part => part !== '')
            server.cwd = cwd.trim()
            server.env = parsePairs(env, '=')
          } else {
            server.url = url.trim()
            server.headers = parsePairs(headers, ':')
          }
          await onSubmit(server)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      const json = mode === 'json' ? parseServerJson(jsonText, t) : undefined
      // What stops this paste from saving: a parse error, or a rename an edit
      // cannot apply — the record keeps the name it was created with.
      const jsonProblem = json === undefined
        ? undefined
        : json.error ?? (editing && json.server.serverName !== initial.serverName
          ? t('jsonNameFixed').replace('{name}', initial.serverName)
          : undefined)

      const onJsonChange = (text) => {
        setJsonText(text)
        const parsed = parseServerJson(text, t)
        // A scope in the paste shows up in the selector that will save it.
        if (parsed.server?.scope !== undefined) setScope(parsed.server.scope)
      }

      const switchMode = (value) => {
        setMode(value)
        // An edit starts from the stored record; a create starts empty, where
        // the placeholder shows the shape.
        if (value === 'json' && jsonText === '') setJsonText(jsonTemplate())
      }

      const modeButton = (value, label) => h('button', {
        key: value,
        type: 'button',
        'aria-pressed': mode === value,
        onClick: () => switchMode(value),
        style: {
          padding: '5px 14px', borderRadius: 999, font: 'inherit', fontSize: 12, cursor: 'pointer',
          border: mode === value ? 'none' : '1px solid transparent',
          background: mode === value ? 'color-mix(in srgb, currentColor 14%, transparent)' : 'transparent',
          color: 'inherit', opacity: mode === value ? 1 : 0.65,
        },
      }, label)

      const scopeChoices = [
        { value: 'global', label: t('global') },
        ...workspaces.map(workspace =>
          ({ value: workspace.path, label: `${t('workspace')} · ${workspace.title}` })),
        // The toolbar can be filtered to a scope the registry no longer lists,
        // and a server created from there still starts in it.
        ...(defaultScope !== undefined && defaultScope !== 'global'
          && !workspaces.some(workspace => workspace.path === defaultScope)
          ? [{ value: defaultScope, label: `${t('workspace')} · ${defaultScope}` }]
          : []),
      ]

      // Both dialogs offer the paste: an edit starts from the stored record,
      // whose credential keys appear blank and keep their stored values.
      const modes = h('div', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3, marginBottom: 18,
          border, borderRadius: 999, background: subtle,
        },
      }, modeButton('form', t('modeForm')), modeButton('json', t('modeJson')))

      // A live region: the parse result and whatever stops the paste from
      // saving are the same slot, and both are worth announcing while someone
      // pastes.
      const jsonPreview = json === undefined
        ? null
        : jsonProblem !== undefined
          ? h('div', { role: 'status', style: { color: '#e5484d', fontSize: 12, marginTop: 6 } }, jsonProblem)
          : h('div', { role: 'status', style: { fontSize: 12, opacity: 0.65, marginTop: 6 } },
            `${t('jsonPreview')} · ${json.server.serverName} · ${json.server.transport === 'stdio' ? json.server.command : json.server.url}`)

      const fields = mode === 'json'
        ? [
          h(Field, { key: 'json', label: t('modeJson'), hint: editing ? t('jsonEditHint') : t('jsonHint') },
            h('textarea', {
              style: { ...fieldStyle, minHeight: 190, fontFamily: 'ui-monospace, monospace' },
              value: jsonText,
              placeholder: JSON_PLACEHOLDER,
              spellCheck: false,
              onChange: event => onJsonChange(event.target.value),
            }),
            jsonPreview),
        ]
        : [
          h('div', {
            key: 'identity',
            style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' },
          },
          h('div', { style: { flex: '1 1 200px', minWidth: 0 } },
            h(Field, { label: t('fieldName'), hint: editing ? undefined : t('fieldNameHint') },
              h('input', {
                style: { ...fieldStyle, ...(editing ? { opacity: 0.6 } : {}) },
                value: name,
                disabled: editing,
                placeholder: 'my-mcp-server',
                onChange: event => setName(event.target.value),
              }))),
          h('div', { style: { flex: '1 1 160px', minWidth: 0 } },
            h(Field, { label: t('fieldTransport') },
              h(Select, {
                options: [
                  { value: 'stdio', label: t('transportStdio') },
                  { value: 'streamable-http', label: t('transportHttp') },
                ],
                value: transport,
                onChange: setTransport,
                ariaLabel: t('fieldTransport'),
                block: true,
              }))),
          h('div', { style: { flex: '0 0 150px' } },
            h(Field, { label: t('fieldTimeout') },
              h('input', {
                style: fieldStyle, value: timeout,
                onChange: event => setTimeoutMs(event.target.value.replace(/[^0-9]/gu, '')),
              })))),
          ...transport === 'stdio'
            ? [
              h(Field, { key: 'command', label: t('fieldCommand') },
                h('input', {
                  style: fieldStyle, value: command, placeholder: 'npx',
                  onChange: event => setCommand(event.target.value),
                })),
              h(Field, { key: 'args', label: t('fieldArgs') },
                h('input', {
                  style: fieldStyle, value: args,
                  placeholder: '-y @modelcontextprotocol/server-memory',
                  onChange: event => setArgs(event.target.value),
                })),
              h(Field, { key: 'env', label: t('fieldEnv'), hint: t('secretHint') },
                h('textarea', {
                  style: { ...fieldStyle, minHeight: 70, fontFamily: 'ui-monospace, monospace' },
                  value: env, onChange: event => setEnv(event.target.value),
                })),
            ]
            : [
              h(Field, { key: 'url', label: t('fieldUrl') },
                h('input', {
                  style: fieldStyle, value: url, placeholder: 'https://example.com/mcp',
                  onChange: event => setUrl(event.target.value),
                })),
              h(Field, { key: 'headers', label: t('fieldHeaders'), hint: t('secretHint') },
                h('textarea', {
                  style: { ...fieldStyle, minHeight: 70, fontFamily: 'ui-monospace, monospace' },
                  value: headers, onChange: event => setHeaders(event.target.value),
                })),
            ],
        ]

      const saveBlocked = busy || jsonProblem !== undefined

      return h('div', { style: { maxWidth: 880 } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 } },
          h('div', null,
            h('div', { style: { fontSize: 20, fontWeight: 600, marginBottom: 6 } },
              editing ? t('editTitle') : t('createTitle')),
            h('div', { style: { fontSize: 13, opacity: 0.65 } },
              editing ? t('editHint') : t('createHint'))),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.8, flexShrink: 0 } },
            t('fieldScope'),
            h(Select, {
              options: scopeChoices,
              value: scope,
              onChange: setScope,
              ariaLabel: t('fieldScope'),
              style: { width: 'auto', minWidth: 190 },
            }))),

        modes,
        fields,

        h('label', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 18,
            fontSize: 12.5, opacity: 0.85, cursor: 'pointer',
          },
        },
        h('input', {
          type: 'checkbox',
          checked: readOnly,
          onChange: event => setReadOnly(event.target.checked),
        }),
        t('fieldReadOnly')),
        h('div', { style: { fontSize: 12, opacity: 0.6, marginTop: 6 } }, t('readOnlyHint')),

        failure === ''
          ? null
          : h('div', { style: { color: '#e5484d', fontSize: 13, marginBottom: 12 } }, failure),

        h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 } },
          h('button', { style: buttonStyle, disabled: busy, onClick: onCancel }, t('cancel')),
          h('button', {
            style: {
              ...buttonStyle, fontWeight: 600, opacity: saveBlocked ? 0.6 : 1,
              background: 'color-mix(in srgb, currentColor 16%, transparent)',
            },
            disabled: saveBlocked,
            onClick: () => { void submit() },
          }, busy ? t('saving') : t('save'))),
      )
    }

    /**
     * The handshake reading taken for one mount when the page was opened.
     *
     * The official client reports a failed connection only to the Host log, so
     * a mount whose tools never arrived is otherwise indistinguishable from a
     * working one. A probe asked for by hand supersedes this line: it is the
     * newer reading and the one the person asked for.
     *
     * @param health - the `health` field of the row, when present.
     * @param probe - the row's manual probe state, when one ran.
     * @param t - the bound dictionary.
     * @returns the line element, or null when there is nothing to report.
     */
    function pageCheckLine(health, probe, t) {
      if (health?.reachable === undefined) return null
      if (probe !== undefined && probe.busy !== true) return null
      return h('div', {
        style: {
          marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap',
          color: health.reachable === true ? '#30a46c' : '#e5484d',
        },
      }, `${health.reachable === true ? t('reachable') : t('unreachable')} (${t('pageCheck')}) — ${health.detail ?? ''}`)
    }

    /**
     * The delete button: it arms on the first click and deletes on the second.
     *
     * @param props - the bound dictionary, whether this row is armed, and the delete.
     * @returns the button element.
     */
    function DeleteButton(props) {
      const { t, pending, onRemove } = props
      const [hovered, setHovered] = useState(false)
      const label = pending ? t('confirmRemove') : t('remove')
      return h('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        onMouseEnter: () => { setHovered(true) },
        onMouseLeave: () => { setHovered(false) },
        onClick: (event) => { event.stopPropagation(); onRemove() },
        style: {
          ...bareIconButtonStyle,
          width: 'auto', padding: pending ? '0 8px' : 0,
          color: pending ? '#e5484d' : 'inherit',
          opacity: pending || hovered ? 1 : 0.55,
          background: pending
            ? 'color-mix(in srgb, #e5484d 14%, transparent)'
            : (hovered ? 'color-mix(in srgb, currentColor 10%, transparent)' : 'transparent'),
          transition: 'background 120ms ease',
        },
      }, h(IconTrashOutlineRegular, { size: 14 }), pending ? h('span', { style: { fontSize: 12 } }, label) : null)
    }

    /**
     * One installed server row.
     * @param props - the record, its title lookup, and the row actions.
     * @returns the row element.
     */
    function ServerRow(props) {
      const { t, server, probe, pending, handlers } = props
      const isGlobal = server.scope === 'global'
      const scopeBadge = isGlobal ? t('global') : `${t('workspace')} · ${props.titleOf(server.scope)}`
      const tools = server.tools ?? []
      // The read-only policy removes tools from `tools` without touching the
      // mount, so its withholdings are what keeps a fully-withheld server from
      // reading as one that never answered.
      const withheld = server.withheld ?? []
      const health = server.health ?? undefined
      // Registered tools and a completed handshake are the only proof of a
      // connection this page holds: the official client connects in the
      // background and publishes no status, so a mount is called connected only
      // when its tools arrived, the page's own check completed a handshake, or
      // a probe asked for by hand did. A mount with none of those is still
      // connecting, and one whose handshake failed is unreachable — never
      // connected. The state is the tile's dot; its words are the tooltip.
      const status = !server.enabled
        ? { label: t('disabled') }
        : server.mounted !== true
          ? { label: t('mountFailed'), color: '#e5484d' }
          : tools.length > 0 || withheld.length > 0 || health?.reachable === true || probe?.reachable === true
            ? { label: t('connected'), color: '#30a46c' }
            : health?.reachable === false || probe?.reachable === false
              ? { label: t('unreachable'), color: '#e5484d' }
              : { label: t('connecting'), color: '#f5a623' }
      const target = server.transport === 'stdio'
        ? `${server.command} ${(server.args ?? []).join(' ')}`.trim()
        : server.url

      const chips = [
        h('span', { key: 'transport', style: chipStyle }, server.transport),
        h('span', { key: 'scope', style: chipStyle }, scopeBadge),
      ]
      if (server.readOnly === false) {
        chips.push(h('span', {
          key: 'readonly',
          style: { ...chipStyle, borderColor: '#f5a623', color: '#f5a623' },
          title: t('readOnlyOpenHint'),
        }, t('readOnlyOpen')))
      } else {
        chips.push(h('span', {
          key: 'readonly',
          style: chipStyle,
          title: t('readOnlyHint'),
        }, t('readOnlyBadge')))
      }
      if (server.mounted && (server.sessions ?? 0) > 0) {
        chips.push(h('span', {
          key: 'sessions',
          style: { ...chipStyle, border: 'none', padding: 0, opacity: 0.5 },
        }, `${server.sessions} ${t('sessions')}`))
      }

      const ghostButton = (icon, label, onClick, extra) => h('button', {
        type: 'button',
        style: {
          ...buttonStyle, padding: '5px 10px', fontSize: 12,
          display: 'inline-flex', alignItems: 'center', gap: 6, ...(extra ?? {}),
        },
        onClick: (event) => { event.stopPropagation(); onClick() },
      }, icon, label)

      return h('div', {
        style: {
          border, borderRadius: 12, padding: '14px 16px', marginBottom: 10,
          opacity: server.enabled ? 1 : 0.55,
        },
      },
      h('div', {
        role: 'button',
        tabIndex: 0,
        title: t('edit'),
        onClick: () => handlers.onEdit(),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.onEdit()
          }
        },
        style: { display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' },
      },
      h(Tile, {
        badge: status.color ?? 'color-mix(in srgb, currentColor 32%, transparent)',
        badgeLabel: status.label,
      }, h(PlugGlyph, { size: 21 })),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600, fontSize: 14 } }, server.serverName),
          ...chips),
        h('div', {
          style: {
            fontSize: 12.5, opacity: 0.55, marginTop: 6, fontFamily: 'ui-monospace, monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, target),
        // A mount that never applied, and a / command that would shadow a live
        // one: the two facts a server can carry that the person has to act on.
        server.mountError === null || server.mountError === undefined
          ? null
          : h('div', { style: { fontSize: 12, color: '#e5484d', marginTop: 6 } }, server.mountError),
        server.commandConflict === true
          ? h('div', {
            style: { fontSize: 12, color: '#e5484d', marginTop: 6 },
            title: t('commandConflictHint'),
          }, `/${server.commandName} ${t('commandConflict')}`)
          : null,
        // Which tools the policy took away, on the row: a person who cannot see
        // a tool the server does expose needs the reason without a second page.
        withheld.length === 0
          ? null
          : h('div', {
            style: { fontSize: 12, opacity: 0.6, marginTop: 6 },
            title: `${t('withheldHint')}\n${withheld.join('\n')}`,
          }, t('withheldTools').replace('{count}', String(withheld.length)))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        ghostButton(
          h(WaveGlyph, { size: 13 }),
          probe?.busy === true ? t('probing') : t('probe'),
          () => handlers.onProbe(),
          { opacity: probe?.busy === true ? 0.6 : 1 },
        ),
        h(Switch, {
          checked: server.enabled,
          title: server.enabled ? t('disabled') : t('enabled'),
          onChange: () => handlers.onToggle(),
        }),
        h(DeleteButton, {
          t,
          pending,
          onRemove: () => handlers.onRemove(),
        }))),

      probe === undefined || probe.busy === true
        ? null
        : h('div', {
          style: {
            marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap',
            color: probe.reachable === true ? '#30a46c' : '#e5484d',
          },
        }, `${probe.reachable === true ? t('reachable') : t('unreachable')} — ${probe.detail ?? ''}`),

      pageCheckLine(health, probe, t))
    }

    /**
     * The Settings page.
     * @param props - injected props plus the bound dictionary.
     * @returns the page element.
     */
    function ScopeSection(props) {
      const { t, load, create, update, toggle, remove, probe, verify } = props
      const [state, setState] = useState(undefined)
      const [failure, setFailure] = useState('')
      const [form, setForm] = useState(undefined)
      const [pending, setPending] = useState('')
      const [probes, setProbes] = useState({})
      const [query, setQuery] = useState('')
      const [scopeFilter, setScopeFilter] = useState('global')

      const refresh = useCallback(async () => {
        try {
          setState(await load())
          setFailure('')
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [load])

      // The Host publishes no connection state for a mount whose tools never
      // arrived — the official client reports that failure to its log alone —
      // so a row is read once, when this section is opened. This component is
      // the MCP page itself: the Settings shell renders only the active
      // section, so the check runs when the person navigates here and not when
      // the Settings dialog opens on its default section. Nothing repeats on
      // its own either — a row already read, or one with tools, is left as it
      // is, and the person's own 探测 is what asks again.
      const openPage = useCallback(async () => {
        try {
          const first = await load()
          setState(first)
          setFailure('')
          const unread = (first.servers ?? [])
            .filter(server => server.enabled === true && server.mounted === true
              && (server.tools ?? []).length === 0 && (server.health ?? null) === null)
            .map(server => server.serverName)
          if (unread.length === 0) return
          await verify(unread)
          setState(await load())
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [load, verify])

      useEffect(() => { void openPage() }, [openPage])

      const workspaces = state?.workspaces ?? []
      const titleOf = useMemo(() => {
        const index = new Map(workspaces.map(workspace => [workspace.path, workspace.title]))
        return path => index.get(path) ?? path
      }, [workspaces])

      const servers = state?.servers ?? []
      const needle = query.trim().toLowerCase()
      const matches = (server) => needle === ''
        || server.serverName.toLowerCase().includes(needle)
        || (server.transport === 'stdio'
          ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`
          : server.url ?? '').toLowerCase().includes(needle)
      // The toolbar count answers the scope filter alone; the section count also
      // answers the search box, so the two differ only while searching.
      const inScope = servers.filter(server => server.scope === scopeFilter)
      const visible = inScope.filter(matches)

      const run = async (work) => {
        try {
          setPending('')
          await work()
          await refresh()
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }

      const runProbe = async (serverName) => {
        setProbes(current => ({ ...current, [serverName]: { busy: true } }))
        try {
          const outcome = await probe(serverName)
          setProbes(current => ({ ...current, [serverName]: outcome }))
        } catch (error) {
          setProbes(current => ({
            ...current,
            [serverName]: { reachable: false, detail: error instanceof Error ? error.message : String(error) },
          }))
        }
      }

      if (form !== undefined) {
        return h('div', { style: { padding: '4px 2px' } },
          h(ServerForm, {
            t,
            workspaces,
            // A server created while the list is filtered to one workspace
            // starts in it: the filter is what the person is looking at.
            defaultScope: scopeFilter,
            initial: form === null ? undefined : form,
            onCancel: () => setForm(undefined),
            onSubmit: async (server) => {
              if (form === null) await create(server)
              else await update(server.serverName, server)
              setForm(undefined)
              await refresh()
            },
          }))
      }

      const scopeChoices = [
        { value: 'global', label: t('global') },
        // Registered workspaces first, then any other scope a server already
        // stores: a scope survives its workspace leaving the registry, and a
        // filter that could not reach it would hide the server.
        ...[...new Set([
          ...workspaces.map(workspace => workspace.path),
          ...servers.map(server => server.scope).filter(scope => scope !== 'global'),
        ])].map(path => ({ value: path, label: `${t('workspace')} · ${titleOf(path)}` })),
      ]

      return h('div', { style: { padding: '4px 2px' } },
        h('div', { style: { fontSize: 24, fontWeight: 650, marginBottom: 16 } }, t('title')),

        // ── scope selector · count · search ──────────────────────────────────
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 } },
          // The trigger IS the pill: a menu measures its anchor, so a pill
          // wrapped around the trigger opened the card to the right of the
          // click target instead of under it.
          h(Select, {
            options: scopeChoices,
            value: scopeFilter,
            onChange: setScopeFilter,
            ariaLabel: t('fieldScope'),
            icon: h(ScreenGlyph, { size: 15 }),
            style: {
              width: 'auto', maxWidth: 260, padding: '6px 12px', borderRadius: 999,
              background: 'transparent', fontSize: 13, opacity: 0.9,
            },
          }),
          h('div', { style: { fontSize: 13, opacity: 0.75 } },
            `${t('count')} ${state === undefined ? 0 : inScope.length}`),
          h('div', { style: { flex: '1 1 180px', minWidth: 0, display: 'flex', justifyContent: 'flex-end' } },
            h('div', {
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                border, borderRadius: 999, background: subtle, width: '100%', maxWidth: 340, minWidth: 0,
              },
            },
            h('span', { style: { opacity: 0.5, display: 'flex' } }, h(SearchGlyph, { size: 15 })),
            h('input', {
              style: {
                border: 'none', background: 'transparent', color: 'inherit', font: 'inherit',
                fontSize: 13, outline: 'none', width: '100%', minWidth: 0,
              },
              value: query,
              placeholder: t('search'),
              onChange: event => setQuery(event.target.value),
            })))),

        failure === ''
          ? null
          : h('div', { style: { color: '#e5484d', fontSize: 13, marginBottom: 14 } }, `${t('errorPrefix')}: ${failure}`),

        // ── installed ────────────────────────────────────────────────────────
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 } },
          h('div', { style: { fontSize: 13, fontWeight: 600, opacity: 0.85 } },
            `${t('installed')} ${visible.length} ${t('items')}`.trim()),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('button', {
              type: 'button', title: t('reload'), style: iconButtonStyle,
              onClick: () => { void refresh() },
            }, h(RefreshGlyph, { size: 15 })),
            h('button', {
              type: 'button',
              style: { ...buttonStyle, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
              onClick: () => setForm(null),
            }, h(PlusGlyph, { size: 15 }), t('newServer')))),

        state === undefined
          ? h('div', { style: { opacity: 0.6, fontSize: 13 } }, t('loading'))
          : visible.length === 0
            ? h('div', { style: { opacity: 0.6, fontSize: 13, padding: '10px 0 18px' } },
              servers.length === 0 ? t('empty') : t('emptyFiltered'))
            : visible.map(server => h(ServerRow, {
              key: server.serverName,
              t,
              server,
              titleOf,
              probe: probes[server.serverName],
              pending: pending === server.serverName,
              handlers: {
                onEdit: () => setForm(server),
                onToggle: () => { void run(() => toggle(server.serverName, !server.enabled)) },
                onProbe: () => { void runProbe(server.serverName) },
                onRemove: () => {
                  if (pending !== server.serverName) {
                    setPending(server.serverName)
                    return
                  }
                  void run(() => remove(server.serverName))
                },
              },
            })),

        h('div', { style: { fontSize: 11, opacity: 0.45, marginTop: 18, lineHeight: 1.7 } },
          h('div', { style: { fontFamily: 'ui-monospace, monospace' } }, `${t('storeAt')}: ${state?.storePath ?? '…'}`),
          h('div', null, t('footerHint'))),
      )
    }

    /**
     * Open the Session a server command ran in, then re-read the baseline.
     *
     * A command issued from a Session the panel has not opened appends its rows
     * to that Session's log without moving the panel there, and the host's
     * blankness verdict for a command-only Session only reaches the client
     * mirror through a refresh. Without both, the person sees the sidebar mark
     * the Session running and nothing else.
     *
     * @param ctx - the client plugin context.
     * @returns the event disposer.
     */
    function followServerCommands(ctx) {
      let names = new Set()
      const refresh = async () => {
        try {
          const state = await request('GET', '/state')
          names = new Set((state.servers ?? []).map(server => server.commandName).filter(name => name !== null))
        } catch {
          // A failed refresh costs only the redirects until the next command.
        }
      }
      void refresh()
      return ctx.on('command/executed', (sessionId, name) => {
        if (!names.has(name)) {
          void refresh()
          return
        }
        try {
          ctx.get('uiWorkspace')?.openSession?.(sessionId)
          void ctx.get('sessions')?.refresh?.()
        } catch {
          // Navigation is best-effort: the command already ran and the Session
          // stays reachable from the sidebar.
        }
      })
    }

    /** Services the page reads. */
    const inject = ['slots', 'locale', 'sessions']

    /** How one server's row reads in the menu: its transport target. */
    function targetOf(server) {
      return server.transport === 'stdio'
        ? `${server.command} ${(server.args ?? []).join(' ')}`.trim()
        : server.url
    }

    /**
     * The `/` source that completes a server name written inside a draft.
     *
     * The host command source owns a leading `/`: picking there starts the
     * server's delegated child, so the command claims the composer for its task
     * and — for exactly that reason — the menu withholds every argument-taking
     * command once the caret leaves the head of the draft. A server name is
     * also the model-facing tool namespace the child is granted, so `/name`
     * written inside a sentence is text the model reads and acts on. This
     * source supplies what the host source withholds: the same names, listed
     * inline, settled by inserting the name as plain text so the rest of the
     * draft stays exactly as typed.
     *
     * @returns the source registration.
     */
    function serverNameSource() {
      /** Servers eligible for a command, as the last read returned them. */
      let entries
      /** In-flight read, shared so concurrent keystrokes issue one request. */
      let pending
      /** Render-side subscribers of the name roll, one per live Session scope. */
      const watchers = new Set()
      const load = (refresh) => {
        if (pending !== undefined) return pending
        if (entries !== undefined && refresh !== true) return Promise.resolve()
        pending = request('GET', '/state').then(
          (state) => {
            entries = (state.servers ?? [])
              // A server without a usable command name, or one whose name is
              // already taken, never registers a command: naming it in a draft
              // would offer the model something no tool answers to.
              .filter(server => server.enabled !== false
                && server.commandName !== null
                && server.commandConflict !== true)
              .map(server => ({ name: server.commandName, description: targetOf(server) }))
            // The draft decorates `/name` tokens the moment a name is on the
            // roll, so a settle has to reach the editor rather than wait for the
            // next keystroke.
            for (const watcher of [...watchers]) {
              try {
                watcher()
              } catch (error) {
                console.error('[dsh-mcp-scope] lexicon listener failed:', error)
              }
            }
          },
          () => {
            // An unreadable list costs the menu its completions, never the
            // composer: the source answers from what it already holds.
          },
        ).then(() => { pending = undefined })
        return pending
      }
      return {
        trigger: '/',
        name: 'mcp',
        async candidates(_session, req) {
          // The head of the draft belongs to the host command source, which runs
          // the server instead of naming it.
          if (req.position !== 'inline') return []
          // The menu just opened: re-read so a server saved in Settings appears
          // without a reload, and answer this keystroke from the list already
          // in hand.
          if (req.query === '') void load(true)
          await load(false)
          const query = req.query.toLowerCase()
          return (entries ?? [])
            .filter(entry => query === '' || entry.name.toLowerCase().includes(query))
            .map(entry => ({
              name: entry.name,
              ...(entry.description === '' || entry.description === undefined
                ? {}
                : { description: entry.description }),
            }))
        },
        onPick(pick) {
          // The server name, which is also the command name: the draft reaches
          // the model, which reaches the server through the tool namespace. The
          // pick lands as an atomic chip whose clipboard projection is `/name`,
          // so the draft, the copy, and the model text are what the plain
          // insertion wrote — while the composer shows the bare name and
          // deletes it whole.
          return {
            insert: {
              source: 'mcp',
              ref: pick.candidate.name,
              label: pick.candidate.name,
              clipboardText: `/${pick.candidate.name}`,
            },
          }
        },
        // A chip is submittable only through the codec of the source it names,
        // so this source carries one.
        codec: {
          clipboardText: ref => `/${ref}`,
          serialize: async ref => `/${ref}`,
        },
        // The render side scans the draft for `/name` and decorates an exact
        // match, which is what gives a server named in a sentence the same chip
        // a `/` reference has. Synchronous and fetch-free by contract: an unread
        // roll answers undefined and stays plain text.
        lexicon() {
          return entries?.map(entry => entry.name)
        },
        subscribeLexicon(_session, listener) {
          watchers.add(listener)
          return () => { watchers.delete(listener) }
        },
        warm() { void load(false) },
      }
    }

    /**
     * Register the Settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-scope: dictionaries')
      ctx.effect(() => followServerCommands(ctx), 'dsh-mcp-scope: follow server commands')
      ctx.inject(['inputTriggers'], (scope) => {
        scope.effect(
          () => scope.inputTriggers.registerSource(serverNameSource()),
          'dsh-mcp-scope: inline server names',
        )
      })
      const t = ctx.locale.bind(NS)
      const injected = () => ({
        load: () => request('GET', '/state'),
        create: server => request('POST', '/servers/create', { server }),
        update: (serverName, server) => request('POST', '/servers/update', { serverName, server }),
        toggle: (serverName, enabled) => request('POST', '/servers/toggle', { serverName, enabled }),
        remove: serverName => request('POST', '/servers/delete', { serverName }),
        probe: serverName => request('POST', '/servers/probe', { serverName }),
        verify: serverNames => request('POST', '/servers/verify', { serverNames }),
      })
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'mcp-scope',
        order: 16,
        label: () => t('nav'),
        locale: NS,
        inject: injected,
      }, ScopeSection))
    }

    exports.name = 'dsh-mcp-scope'
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
