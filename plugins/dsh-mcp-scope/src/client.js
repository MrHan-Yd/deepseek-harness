/**
 * dsh-mcp-scope browser half: the Settings page for workspace-scoped MCP servers.
 *
 * Shipped as a Dynamic Client bundle without a build step: the factory takes
 * `react` from the platform module table and builds every element with
 * `createElement`, so the file in `src/` is the file a reviewer reads. Icons are
 * inline SVG for the same reason: the bundle resolves nothing but `react`.
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

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.mcpScope'

    const zh = {
      nav: 'MCP 服务器',
      title: 'MCP 服务器',
      count: 'MCP 服务器',
      search: '搜索 MCP 服务器…',
      scopeAll: '全部作用域',
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
      mounted: '已连接',
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
      fieldTimeout: '超时时间 MS',
      fieldCommand: '命令',
      fieldArgs: '参数（空格分隔）',
      fieldCwd: '工作目录（可选）',
      secretHint: '值留空表示保持原值 —— 凭据不会回传到这个页面',
      fieldEnv: '环境变量（可选，每行 KEY=VALUE）',
      fieldUrl: 'URL',
      fieldHeaders: 'Headers（可选，每行 KEY: VALUE）',
      transportStdio: 'stdio（本地命令）',
      transportHttp: 'streamable-http（远程地址）',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      loading: '加载中…',
      tools: '个工具',
      sessions: '个会话可见',
      probe: '探测',
      probing: '探测中…',
      reachable: '可达',
      unreachable: '不可达',
      trial: '试用',
      trialTool: '工具',
      trialArgs: '参数（JSON）',
      trialRun: '运行',
      trialRunning: '运行中…',
      trialResult: '返回',
      trialHint: '经官方工具管线调用（权限与审批照常生效）；结果只显示在本页，不进模型上下文。',
      trialNoTools: '该服务器当前没有注册工具。',
      scopeHint: '选择该服务器在哪些会话中可见。',
      errorPrefix: '操作失败',
      commandChipHint: '在输入框输入 / 即可让一个只能调用这个服务器工具的子代理干活，结果会回到当前会话',
      commandUnavailable: '名称不能作命令',
      commandUnavailableHint: '斜杠命令只接受小写字母开头的名字，重命名服务器后即可用 / 调用',
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
      scopeAll: 'All scopes',
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
      mounted: 'Connected',
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
      fieldTimeout: 'Timeout ms',
      fieldCommand: 'Command',
      fieldArgs: 'Arguments (space separated)',
      fieldCwd: 'Working directory (optional)',
      secretHint: 'A blank value keeps the stored one — credentials are never sent to this page',
      fieldEnv: 'Environment (optional, one KEY=VALUE per line)',
      fieldUrl: 'URL',
      fieldHeaders: 'Headers (optional, one KEY: VALUE per line)',
      transportStdio: 'stdio (local command)',
      transportHttp: 'streamable-http (remote URL)',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      loading: 'Loading…',
      tools: 'tools',
      sessions: 'live sessions',
      probe: 'Probe',
      probing: 'Probing…',
      reachable: 'Reachable',
      unreachable: 'Unreachable',
      trial: 'Trial',
      trialTool: 'Tool',
      trialArgs: 'Arguments (JSON)',
      trialRun: 'Run',
      trialRunning: 'Running…',
      trialResult: 'Result',
      trialHint: 'Runs through the official tool pipeline (permission and approval still apply); the result stays on this page and never enters model context.',
      trialNoTools: 'This server has no registered tools yet.',
      scopeHint: 'Choose which sessions can see this server.',
      errorPrefix: 'Failed',
      commandChipHint: 'Type / in the composer to run a child agent limited to this server’s tools; its result returns to this session',
      commandUnavailable: 'No / command',
      commandUnavailableHint: 'A slash command name must start with a lowercase letter; rename the server to invoke it as /name',
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
    const chipStyle = {
      fontSize: 11, padding: '2px 8px', borderRadius: 6, border: softBorder,
      opacity: 0.75, whiteSpace: 'nowrap',
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
    const TrashGlyph = (props) => h(Glyph, { ...props, d: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6' })
    const ScreenGlyph = (props) => h(Glyph, { ...props, d: 'M3 5h18v11H3zM9 20h6M12 16v4' })
    const WaveGlyph = (props) => h(Glyph, { ...props, d: 'M3 12h3l2.5-6 4 12 2.5-6h6' })
    const PlayGlyph = (props) => h(Glyph, { ...props, d: 'M8 5.5 18 12 8 18.5z' })

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
     * @param props - the glyph to show.
     * @returns the tile element.
     */
    function Tile(props) {
      return h('div', {
        style: {
          position: 'relative', width: 42, height: 42, borderRadius: 11, border,
          background: subtle, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, opacity: 0.9,
        },
      }, props.children)
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

    /**
     * The create/edit form.
     * @param props - form props.
     * @returns the form element.
     */
    function ServerForm(props) {
      const { t, workspaces, initial, onSubmit, onCancel } = props
      const editing = initial !== undefined
      const [name, setName] = useState(initial?.serverName ?? '')
      const [scope, setScope] = useState(initial?.scope ?? 'global')
      const [transport, setTransport] = useState(initial?.transport ?? 'stdio')
      const [timeout, setTimeoutMs] = useState(String(initial?.toolCallTimeoutMs ?? 30000))
      const [command, setCommand] = useState(initial?.command ?? '')
      const [args, setArgs] = useState((initial?.args ?? []).join(' '))
      const [cwd, setCwd] = useState(initial?.cwd ?? '')
      const [env, setEnv] = useState(formatKeys(initial?.envKeys, '='))
      const [url, setUrl] = useState(initial?.url ?? '')
      const [headers, setHeaders] = useState(formatKeys(initial?.headerKeys, ':'))
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState('')

      const submit = async () => {
        setBusy(true)
        setFailure('')
        try {
          const server = {
            serverName: name.trim(),
            scope,
            transport,
            toolCallTimeoutMs: Number(timeout) || 30000,
            enabled: initial?.enabled !== false,
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

      const scopeOptions = [
        h('option', { key: 'global', value: 'global' }, t('global')),
        ...workspaces.map(workspace =>
          h('option', { key: workspace.path, value: workspace.path },
            `${t('workspace')} · ${workspace.title}`)),
      ]

      return h('div', { style: { maxWidth: 880 } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 } },
          h('div', null,
            h('div', { style: { fontSize: 20, fontWeight: 600, marginBottom: 6 } },
              editing ? t('editTitle') : t('createTitle')),
            h('div', { style: { fontSize: 13, opacity: 0.65 } },
              editing ? t('editHint') : t('createHint'))),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.8, flexShrink: 0 } },
            t('fieldScope'),
            h('select', {
              style: { ...fieldStyle, width: 'auto', minWidth: 190 },
              value: scope,
              onChange: event => setScope(event.target.value),
            }, scopeOptions))),

        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } },
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
              h('select', { style: fieldStyle, value: transport, onChange: event => setTransport(event.target.value) },
                h('option', { value: 'stdio' }, t('transportStdio')),
                h('option', { value: 'streamable-http' }, t('transportHttp'))))),
          h('div', { style: { flex: '0 0 150px' } },
            h(Field, { label: t('fieldTimeout') },
              h('input', {
                style: fieldStyle, value: timeout,
                onChange: event => setTimeoutMs(event.target.value.replace(/[^0-9]/gu, '')),
              })))),

        transport === 'stdio'
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
            h(Field, { key: 'cwd', label: t('fieldCwd') },
              h('input', {
                style: fieldStyle, value: cwd, placeholder: '/absolute/working/directory',
                onChange: event => setCwd(event.target.value),
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

        failure === ''
          ? null
          : h('div', { style: { color: '#e5484d', fontSize: 13, marginBottom: 12 } }, failure),

        h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 } },
          h('button', { style: buttonStyle, disabled: busy, onClick: onCancel }, t('cancel')),
          h('button', {
            style: {
              ...buttonStyle, fontWeight: 600, opacity: busy ? 0.6 : 1,
              background: 'color-mix(in srgb, currentColor 16%, transparent)',
            },
            disabled: busy,
            onClick: () => { void submit() },
          }, busy ? t('saving') : t('save'))),
      )
    }

    /**
     * One installed server row.
     * @param props - the record, its title lookup, and the row actions.
     * @returns the row element.
     */
    function ServerRow(props) {
      const { t, server, probe, pending, trial, trialResult, trialBusy, handlers } = props
      const isGlobal = server.scope === 'global'
      const scopeBadge = isGlobal ? t('global') : `${t('workspace')} · ${props.titleOf(server.scope)}`
      const status = !server.enabled
        ? { text: `○ ${t('disabled')}`, color: undefined }
        : server.mounted
          ? { text: `● ${t('mounted')}`, color: '#30a46c' }
          : { text: `○ ${t('mountFailed')}`, color: '#e5484d' }
      const target = server.transport === 'stdio'
        ? `${server.command} ${(server.args ?? []).join(' ')}`.trim()
        : server.url

      const chips = [
        h('span', { key: 'transport', style: chipStyle }, server.transport),
        server.commandName === null
          ? h('span', {
            key: 'command',
            style: { ...chipStyle, color: '#e5484d', opacity: 0.9 },
            title: t('commandUnavailableHint'),
          }, t('commandUnavailable'))
          : h('span', {
            key: 'command',
            style: {
              ...chipStyle, fontFamily: 'ui-monospace, monospace',
              color: server.commandConflict === true ? '#e5484d' : undefined,
            },
            title: server.commandConflict === true ? t('commandConflictHint') : t('commandChipHint'),
          }, server.commandConflict === true ? `/${server.commandName} ${t('commandConflict')}` : `/${server.commandName}`),
        h('span', { key: 'scope', style: chipStyle }, scopeBadge),
        h('span', { key: 'status', style: { ...chipStyle, color: status.color } }, status.text),
        h('span', { key: 'tools', style: chipStyle },
          `${(server.tools ?? []).length} ${t('tools')}`),
      ]
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
      h(Tile, null, h(PlugGlyph, { size: 21 })),
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
        server.mountError === null || server.mountError === undefined
          ? null
          : h('div', { style: { fontSize: 12, color: '#e5484d', marginTop: 6 } }, server.mountError)),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        ghostButton(
          h(WaveGlyph, { size: 13 }),
          probe?.busy === true ? t('probing') : t('probe'),
          () => handlers.onProbe(),
          { opacity: probe?.busy === true ? 0.6 : 1 },
        ),
        ghostButton(
          h(PlayGlyph, { size: 13 }),
          t('trial'),
          () => handlers.onTrial(),
          { opacity: server.mounted === true ? 1 : 0.5 },
        ),
        h(Switch, {
          checked: server.enabled,
          title: server.enabled ? t('disabled') : t('enabled'),
          onChange: () => handlers.onToggle(),
        }),
        h('button', {
          type: 'button',
          title: pending ? t('confirmRemove') : t('remove'),
          onClick: (event) => { event.stopPropagation(); handlers.onRemove() },
          style: {
            ...iconButtonStyle,
            width: 'auto', padding: pending ? '0 10px' : 0,
            color: pending ? '#e5484d' : 'inherit',
            opacity: pending ? 1 : 0.6,
          },
        }, h(TrashGlyph, { size: 16 }), pending ? h('span', { style: { fontSize: 12 } }, t('confirmRemove')) : null))),

      probe === undefined || probe.busy === true
        ? null
        : h('div', {
          style: {
            marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap',
            color: probe.reachable === true ? '#30a46c' : '#e5484d',
          },
        }, `${probe.reachable === true ? t('reachable') : t('unreachable')} — ${probe.detail ?? ''}`),

      trial === undefined
        ? null
        : h('div', { style: { marginTop: 12, borderTop: border, paddingTop: 12 } },
          h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 10 } }, t('trialHint')),
          (server.tools ?? []).length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.6 } }, t('trialNoTools'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h('label', { style: { fontSize: 12, opacity: 0.7 } }, t('trialTool'),
                h('select', {
                  style: { ...fieldStyle, marginTop: 4 },
                  value: trial.toolName,
                  onChange: event => handlers.onTrialChange({ ...trial, toolName: event.target.value }),
                }, (server.tools ?? []).map(toolName =>
                  h('option', { key: toolName, value: toolName }, toolName)))),
              h('label', { style: { fontSize: 12, opacity: 0.7 } }, t('trialArgs'),
                h('textarea', {
                  style: { ...fieldStyle, marginTop: 4, minHeight: 60, fontFamily: 'ui-monospace, monospace' },
                  value: trial.args,
                  onChange: event => handlers.onTrialChange({ ...trial, args: event.target.value }),
                })),
              h('div', { style: { display: 'flex', gap: 8 } },
                h('button', {
                  style: { ...buttonStyle, fontWeight: 600, opacity: trialBusy ? 0.6 : 1 },
                  disabled: trialBusy,
                  onClick: () => { void handlers.onTrialRun() },
                }, trialBusy ? t('trialRunning') : t('trialRun')),
                h('button', { style: buttonStyle, onClick: () => handlers.onTrialClose() }, t('cancel'))),
              trialResult === undefined
                ? null
                : h('div', null,
                  h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 4 } },
                    `${t('trialResult')}${trialResult.durationMs === undefined ? '' : ` · ${trialResult.durationMs}ms`}${trialResult.isError === true ? ' · error' : ''}`),
                  h('pre', {
                    style: {
                      margin: 0, padding: 10, borderRadius: 8, border, background: subtle,
                      fontSize: 11, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap',
                    },
                  }, trialResult.resultJson ?? '')))))
    }

    /**
     * Read the current session id from the sessions store face (structural:
     * only the leaf this page needs is read, so a store-shape change across
     * harness lines degrades to "no session" instead of throwing).
     * @param sessions - the sessions service face.
     * @returns the current session id, or undefined.
     */
    function currentSessionId(sessions) {
      try {
        const list = sessions?.list
        const getSnapshot = list?.getSnapshot
        if (typeof getSnapshot !== 'function') return undefined
        const current = getSnapshot().current
        return typeof current === 'string' ? current : undefined
      } catch {
        return undefined
      }
    }

    /**
     * The Settings page.
     * @param props - injected props plus the bound dictionary.
     * @returns the page element.
     */
    function ScopeSection(props) {
      const { t, load, create, update, toggle, remove, probe, callTool } = props
      const [state, setState] = useState(undefined)
      const [failure, setFailure] = useState('')
      const [form, setForm] = useState(undefined)
      const [pending, setPending] = useState('')
      const [probes, setProbes] = useState({})
      const [trial, setTrial] = useState(undefined)
      const [trialResult, setTrialResult] = useState(undefined)
      const [trialBusy, setTrialBusy] = useState(false)
      const [query, setQuery] = useState('')
      const [scopeFilter, setScopeFilter] = useState('all')

      const refresh = useCallback(async () => {
        try {
          setState(await load())
          setFailure('')
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [load])

      useEffect(() => { void refresh() }, [refresh])

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
      const inScope = servers.filter(server => scopeFilter === 'all' || server.scope === scopeFilter)
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

      const openTrial = (server) => {
        setTrialResult(undefined)
        setTrial({ serverName: server.serverName, toolName: (server.tools ?? [])[0] ?? '', args: '{}' })
      }

      const runTrial = async () => {
        setTrialBusy(true)
        setTrialResult(undefined)
        try {
          setTrialResult(await callTool(trial.serverName, trial.toolName, trial.args))
        } catch (error) {
          setTrialResult({ isError: true, resultJson: error instanceof Error ? error.message : String(error) })
        } finally {
          setTrialBusy(false)
        }
      }

      if (form !== undefined) {
        return h('div', { style: { padding: '4px 2px' } },
          h(ServerForm, {
            t,
            workspaces,
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

      const scopeOptions = [
        h('option', { key: 'all', value: 'all' }, t('scopeAll')),
        h('option', { key: 'global', value: 'global' }, t('global')),
        // Registered workspaces first, then any other scope a server already
        // stores: a scope survives its workspace leaving the registry, and a
        // filter that could not reach it would hide the server.
        ...[...new Set([
          ...workspaces.map(workspace => workspace.path),
          ...servers.map(server => server.scope).filter(scope => scope !== 'global'),
        ])].map(path =>
          h('option', { key: path, value: path }, `${t('workspace')} · ${titleOf(path)}`)),
      ]

      return h('div', { style: { padding: '4px 2px' } },
        h('div', { style: { fontSize: 24, fontWeight: 650, marginBottom: 16 } }, t('title')),

        // ── scope selector · count · search ──────────────────────────────────
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 } },
          h('div', {
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
              border, borderRadius: 999, opacity: 0.9,
            },
          },
          h(ScreenGlyph, { size: 15 }),
          h('select', {
            style: {
              border: 'none', background: 'transparent', color: 'inherit', font: 'inherit',
              fontSize: 13, outline: 'none', cursor: 'pointer', maxWidth: 220,
            },
            value: scopeFilter,
            onChange: event => setScopeFilter(event.target.value),
          }, scopeOptions)),
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
              trial: trial?.serverName === server.serverName ? trial : undefined,
              trialResult: trial?.serverName === server.serverName ? trialResult : undefined,
              trialBusy,
              handlers: {
                onEdit: () => setForm(server),
                onToggle: () => { void run(() => toggle(server.serverName, !server.enabled)) },
                onProbe: () => { void runProbe(server.serverName) },
                onTrial: () => openTrial(server),
                onTrialChange: (next) => setTrial(next),
                onTrialRun: () => runTrial(),
                onTrialClose: () => { setTrial(undefined); setTrialResult(undefined) },
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

    /**
     * Register the Settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-scope: dictionaries')
      ctx.effect(() => followServerCommands(ctx), 'dsh-mcp-scope: follow server commands')
      const t = ctx.locale.bind(NS)
      const sessionId = () => currentSessionId(ctx.get('sessions'))
      const injected = () => ({
        load: () => request('GET', '/state'),
        create: server => request('POST', '/servers/create', { server }),
        update: (serverName, server) => request('POST', '/servers/update', { serverName, server }),
        toggle: (serverName, enabled) => request('POST', '/servers/toggle', { serverName, enabled }),
        remove: serverName => request('POST', '/servers/delete', { serverName }),
        probe: serverName => request('POST', '/servers/probe', { serverName }),
        callTool: (serverName, toolName, argumentsJson) =>
          request('POST', '/servers/call', { serverName, toolName, argumentsJson, sessionId: sessionId() }),
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
