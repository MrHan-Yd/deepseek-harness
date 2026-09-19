/**
 * dsh-mcp-scope browser half: the Settings page for workspace-scoped MCP servers.
 *
 * Shipped as a Dynamic Client bundle without a build step: the factory takes
 * `react` from the platform module table and builds every element with
 * `createElement`, so the file in `lib/` is the file a reviewer reads.
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
      intro: '按工作区管理 MCP 服务器。作用域为「全局」的服务器对所有会话可见；作用域为某个工作区的服务器只在该工作区的会话中可见。',
      storeAt: '配置存储',
      reload: '刷新',
      add: '添加服务器',
      empty: '还没有配置任何 MCP 服务器。',
      global: '全局',
      workspace: '工作区',
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
    }

    const en = {
      nav: 'MCP servers',
      title: 'MCP servers',
      intro: 'Manage MCP servers per workspace. A server scoped to Global is visible to every session; a server scoped to one workspace is visible only to sessions running in it.',
      storeAt: 'Config store',
      reload: 'Refresh',
      add: 'Add server',
      empty: 'No MCP servers configured yet.',
      global: 'Global',
      workspace: 'Workspace',
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
    }

    /** Tokens shared by every control; neutral so both themes render. */
    const border = '1px solid color-mix(in srgb, currentColor 18%, transparent)'
    const subtle = 'color-mix(in srgb, currentColor 6%, transparent)'
    const fieldStyle = {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
      border, background: subtle, color: 'inherit', font: 'inherit', outline: 'none',
    }
    const buttonStyle = {
      padding: '7px 14px', borderRadius: 8, border, background: subtle,
      color: 'inherit', font: 'inherit', cursor: 'pointer',
    }
    const primaryStyle = {
      ...buttonStyle, background: 'color-mix(in srgb, currentColor 16%, transparent)', fontWeight: 600,
    }

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
      return h('label', { style: { display: 'block', marginBottom: 14 } },
        h('div', { style: { fontSize: 12, opacity: 0.75, marginBottom: 5 } }, props.label),
        props.children,
        props.hint === undefined
          ? null
          : h('div', { style: { fontSize: 11, opacity: 0.5, marginTop: 4 } }, props.hint))
    }

    /**
     * Parse KEY=VALUE lines into a map.
     * @param text - the textarea contents.
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
        h('option', { key: 'global', value: 'global' }, `${t('global')}`),
        ...workspaces.map(workspace =>
          h('option', { key: workspace.path, value: workspace.path },
            `${t('workspace')} · ${workspace.title}`)),
      ]

      return h('div', { style: { maxWidth: 720 } },
        h('div', { style: { fontSize: 20, fontWeight: 600, marginBottom: 6 } },
          editing ? t('editTitle') : t('createTitle')),
        h('div', { style: { fontSize: 13, opacity: 0.65, marginBottom: 22 } },
          editing ? t('editHint') : t('createHint')),

        h(Field, { label: t('fieldName'), hint: editing ? undefined : t('fieldNameHint') },
          h('input', {
            style: { ...fieldStyle, ...(editing ? { opacity: 0.6 } : {}) },
            value: name,
            disabled: editing,
            placeholder: 'my-mcp-server',
            onChange: event => setName(event.target.value),
          })),

        h(Field, { label: t('fieldScope'), hint: t('scopeHint') },
          h('select', { style: fieldStyle, value: scope, onChange: event => setScope(event.target.value) }, scopeOptions)),

        h(Field, { label: t('fieldTransport') },
          h('select', { style: fieldStyle, value: transport, onChange: event => setTransport(event.target.value) },
            h('option', { value: 'stdio' }, t('transportStdio')),
            h('option', { value: 'streamable-http' }, t('transportHttp')))),

        h(Field, { label: t('fieldTimeout') },
          h('input', {
            style: fieldStyle, value: timeout,
            onChange: event => setTimeoutMs(event.target.value.replace(/[^0-9]/gu, '')),
          })),

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

        h('div', { style: { display: 'flex', gap: 10, marginTop: 8 } },
          h('button', {
            style: { ...primaryStyle, opacity: busy ? 0.6 : 1 },
            disabled: busy,
            onClick: () => { void submit() },
          }, busy ? t('saving') : t('save')),
          h('button', { style: buttonStyle, disabled: busy, onClick: onCancel }, t('cancel'))),
      )
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

      const run = async (work) => {
        try {
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

      return h('div', { style: { padding: '4px 2px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
          h('div', { style: { fontSize: 20, fontWeight: 600 } }, t('title')),
          h('div', { style: { display: 'flex', gap: 10 } },
            h('button', { style: buttonStyle, onClick: () => { void refresh() } }, t('reload')),
            h('button', { style: primaryStyle, onClick: () => setForm(null) }, t('add')))),
        h('div', { style: { fontSize: 13, opacity: 0.65, marginBottom: 8 } }, t('intro')),
        h('div', { style: { fontSize: 11, opacity: 0.45, marginBottom: 20, fontFamily: 'ui-monospace, monospace' } },
          `${t('storeAt')}: ${state?.storePath ?? '…'}`),

        failure === ''
          ? null
          : h('div', { style: { color: '#e5484d', fontSize: 13, marginBottom: 14 } }, `${t('errorPrefix')}: ${failure}`),

        state === undefined
          ? h('div', { style: { opacity: 0.6, fontSize: 13 } }, t('loading'))
          : state.servers.length === 0
            ? h('div', { style: { opacity: 0.6, fontSize: 13 } }, t('empty'))
            : state.servers.map(server => {
              const isGlobal = server.scope === 'global'
              const badge = isGlobal ? t('global') : `${t('workspace')} · ${titleOf(server.scope)}`
              return h('div', {
                key: server.serverName,
                style: {
                  border, borderRadius: 12, padding: '14px 16px', marginBottom: 12,
                  opacity: server.enabled ? 1 : 0.55,
                },
              },
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
                h('div', { style: { minWidth: 0 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 600 } }, server.serverName),
                    h('span', { style: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border, opacity: 0.8 } }, badge),
                    h('span', { style: { fontSize: 11, opacity: 0.55 } }, server.transport),
                    h('span', {
                      style: {
                        fontSize: 11, opacity: 0.7,
                        color: server.mounted ? '#30a46c' : undefined,
                      },
                    }, server.enabled ? (server.mounted ? `● ${t('mounted')}` : `○ ${t('mountFailed')}`) : `○ ${t('disabled')}`),
                    server.mounted
                      ? h('span', { style: { fontSize: 11, opacity: 0.55 } },
                        `${server.sessions ?? 0} ${t('sessions')}`)
                      : null),
                  h('div', {
                    style: {
                      fontSize: 12, opacity: 0.55, marginTop: 6,
                      fontFamily: 'ui-monospace, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    },
                  }, server.transport === 'stdio'
                    ? `${server.command} ${(server.args ?? []).join(' ')}`
                    : server.url),
                  server.mountError === null || server.mountError === undefined
                    ? null
                    : h('div', { style: { fontSize: 12, color: '#e5484d', marginTop: 6 } }, server.mountError)),
                h('div', { style: { display: 'flex', gap: 8, flexShrink: 0 } },
                  h('button', {
                    style: buttonStyle,
                    disabled: probes[server.serverName]?.busy === true,
                    onClick: () => { void runProbe(server.serverName) },
                  }, probes[server.serverName]?.busy === true ? t('probing') : t('probe')),
                  h('button', {
                    style: buttonStyle,
                    disabled: server.mounted !== true,
                    onClick: () => openTrial(server),
                  }, t('trial')),
                  h('button', {
                    style: buttonStyle,
                    onClick: () => { void run(() => toggle(server.serverName, !server.enabled)) },
                  }, server.enabled ? t('disabled') : t('enabled')),
                  h('button', { style: buttonStyle, onClick: () => setForm(server) }, t('edit')),
                  h('button', {
                    style: { ...buttonStyle, color: pending === server.serverName ? '#e5484d' : 'inherit' },
                    onClick: () => {
                      if (pending !== server.serverName) {
                        setPending(server.serverName)
                        return
                      }
                      setPending('')
                      void run(() => remove(server.serverName))
                    },
                  }, pending === server.serverName ? t('confirmRemove') : t('remove')))),

              probes[server.serverName] === undefined
                ? null
                : h('div', {
                  style: {
                    marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap',
                    color: probes[server.serverName].reachable === true ? '#30a46c' : '#e5484d',
                  },
                }, probes[server.serverName].busy === true
                  ? t('probing')
                  : `${probes[server.serverName].reachable === true ? t('reachable') : t('unreachable')} — ${probes[server.serverName].detail ?? ''}`),

              trial === undefined || trial.serverName !== server.serverName
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
                          onChange: event => setTrial({ ...trial, toolName: event.target.value }),
                        }, (server.tools ?? []).map(name => h('option', { key: name, value: name }, name)))),
                      h('label', { style: { fontSize: 12, opacity: 0.7 } }, t('trialArgs'),
                        h('textarea', {
                          style: { ...fieldStyle, marginTop: 4, minHeight: 60, fontFamily: 'ui-monospace, monospace' },
                          value: trial.args,
                          onChange: event => setTrial({ ...trial, args: event.target.value }),
                        })),
                      h('div', { style: { display: 'flex', gap: 8 } },
                        h('button', {
                          style: { ...primaryStyle, opacity: trialBusy ? 0.6 : 1 },
                          disabled: trialBusy,
                          onClick: () => { void runTrial() },
                        }, trialBusy ? t('trialRunning') : t('trialRun')),
                        h('button', {
                          style: buttonStyle,
                          onClick: () => { setTrial(undefined); setTrialResult(undefined) },
                        }, t('cancel'))),
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
            }),
      )
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

    /** Services the page reads. */
    const inject = ['slots', 'locale', 'sessions']

    /**
     * Register the Settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-scope: dictionaries')
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
