/**
 * dsh-agent-scope browser half: the Settings page for workspace-scoped named
 * sub-agents.
 *
 * Shipped as a Dynamic Client bundle without a build step: the factory takes
 * `react` and the shared `@deepseek-ai/dsh-client-ui-primitives` from the
 * platform module table and builds every element with `createElement`, so the
 * file in `src/` is the file a reviewer reads. Other icons are inline SVG for
 * the same reason: the bundle resolves nothing else.
 *
 * The page talks to the host half over the same-origin `/agent-scope/api`
 * routes and always sends the `x-dsh-agent-scope` header the host requires.
 *
 * @module dsh-agent-scope/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-scope',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    // The dropdown trigger's chevron and list come from the shared primitives:
    // `Menu` is the control every other Settings row opens, and the module table
    // seeds the package for dynamic bundles, so no build step or manifest entry
    // is needed to reach it.
    const { IconChevronDownOutline14, Menu } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.agentScope'

    /** Swatches offered for a definition's color marker. */
    const COLORS = [
      '#d9a521', '#e5484d', '#e07b39', '#2f9e7a',
      '#2fa8c4', '#4f7cf7', '#7c5cf7', '#c45cc4',
    ]

    const zh = {
      nav: '子智能体',
      title: '子智能体',
      count: '子智能体',
      search: '搜索子智能体…',
      global: '全局',
      workspace: '工作区',
      installed: '已安装',
      items: '项',
      newAgent: '新建',
      reload: '刷新',
      add: '添加子智能体',
      empty: '还没有配置任何子智能体。',
      emptyFiltered: '没有匹配的子智能体。',
      enabled: '已启用',
      disabled: '已停用',
      mountFailed: '装载失败',
      mounted: '已装载',
      edit: '编辑',
      remove: '删除',
      confirmRemove: '确认删除',
      createTitle: '新建子智能体',
      editTitle: '编辑子智能体',
      createHint: '填写子智能体名称、工具和系统提示词，保存后返回列表。',
      editHint: '修改配置并保存。名称不可更改。',
      fieldName: '名称',
      fieldNameHint: '会成为模型可见的委派工具名与斜杠命令：小写字母开头，可含数字、下划线、连字符',
      fieldColor: '颜色标记',
      fieldModel: '模型',
      modelInherit: '继承默认',
      modelHint: '选择该子智能体使用的模型；「继承默认」让子智能体沿用会话的模型。',
      fieldDescription: '描述',
      descriptionPlaceholder: '展示给模型的简要说明',
      fieldTools: '工具权限',
      toolsAll: '默认所有权限',
      toolsCustom: '自定义可用工具',
      toolsHint: '控制该子智能体可以调用的工具范围。',
      toolsNone: '当前没有可列出的工具。先打开一个会话，让预设组合注册工具后再回到这里。',
      fieldSystemPrompt: '系统提示词',
      systemPromptPlaceholder: '描述这个子智能体的角色、边界和规则...',
      fieldInject: '注入 AGENTS.md',
      injectHint: '把指令文件的内容附加到该子智能体的系统提示词。',
      fieldScope: '作用域',
      scopeHint: '选择该子智能体在哪些会话中可见。',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      loading: '加载中…',
      sessions: '个会话可见',
      modelInherited: '继承默认',
      toolsAllBadge: '全部工具',
      toolsBadge: '个工具',
      errorPrefix: '操作失败',
      instructionFound: '指令文件',
      instructionMissing: '未找到指令文件',
      commandChipHint: '在输入框输入 / 即可调用；它跑完后结果会作为通知回到当前会话',
      injectBadge: 'AGENTS.md 已注入',
      injectBadgeMissing: 'AGENTS.md 文件不存在',
      mountError: '装载原因',
      storeAt: '配置存储',
      footerHint: '作用域为「全局」的子智能体对所有会话可见；作用域为某个工作区的只在该工作区的会话中可见。每个子智能体以同名工具提供给模型。',
    }

    const en = {
      nav: 'Sub-agents',
      title: 'Sub-agents',
      count: 'Sub-agents',
      search: 'Search sub-agents…',
      global: 'Global',
      workspace: 'Workspace',
      installed: 'Installed',
      items: '',
      newAgent: 'New',
      reload: 'Refresh',
      add: 'Add sub-agent',
      empty: 'No sub-agents configured yet.',
      emptyFiltered: 'No sub-agent matches.',
      enabled: 'Enabled',
      disabled: 'Disabled',
      mountFailed: 'Mount failed',
      mounted: 'Mounted',
      edit: 'Edit',
      remove: 'Delete',
      confirmRemove: 'Confirm delete',
      createTitle: 'New sub-agent',
      editTitle: 'Edit sub-agent',
      createHint: 'Fill in the name, tools, and system prompt; saving returns to the list.',
      editHint: 'Change the configuration and save. The name cannot change.',
      fieldName: 'Name',
      fieldNameHint: 'Becomes the model-facing delegation tool name and a slash command: lowercase start, then digits, underscores, hyphens',
      fieldColor: 'Color',
      fieldModel: 'Model',
      modelInherit: 'Inherit default',
      modelHint: 'The model this sub-agent runs on; “Inherit default” keeps the session’s own model.',
      fieldDescription: 'Description',
      descriptionPlaceholder: 'A short note shown to the model',
      fieldTools: 'Tool access',
      toolsAll: 'All tools',
      toolsCustom: 'Selected tools',
      toolsHint: 'Controls which tools this sub-agent may call.',
      toolsNone: 'No tools to list yet. Open a session so a preset composition registers its tools, then come back.',
      fieldSystemPrompt: 'System prompt',
      systemPromptPlaceholder: 'Describe this sub-agent’s role, boundaries, and rules…',
      fieldInject: 'Inject AGENTS.md',
      injectHint: 'Appends the instruction file to this sub-agent’s system prompt.',
      fieldScope: 'Scope',
      scopeHint: 'Choose which sessions can see this sub-agent.',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      loading: 'Loading…',
      sessions: 'live sessions',
      modelInherited: 'Inherited',
      toolsAllBadge: 'all tools',
      toolsBadge: 'tools',
      errorPrefix: 'Failed',
      instructionFound: 'Instruction file',
      instructionMissing: 'No instruction file at',
      commandChipHint: 'Type / in the composer to run it; the result returns to this session as a notice',
      injectBadge: 'AGENTS.md injected',
      injectBadgeMissing: 'AGENTS.md missing',
      mountError: 'Mount reason',
      storeAt: 'Config store',
      footerHint: 'A sub-agent scoped to Global is visible to every session; one scoped to a workspace is visible only to sessions running in it. Each sub-agent is offered to the model as a tool of the same name.',
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

    /** Sub-agent tile glyph: a robot head. */
    const BotGlyph = (props) => h(Glyph, {
      ...props,
      d: 'M9 3v3M15 3v3M5 9h14a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1ZM9 13h.01M15 13h.01',
    })
    const SearchGlyph = (props) => h(Glyph, { ...props, d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3' })
    const RefreshGlyph = (props) => h(Glyph, { ...props, d: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6' })
    const PlusGlyph = (props) => h(Glyph, { ...props, d: 'M12 5v14M5 12h14' })
    const TrashGlyph = (props) => h(Glyph, { ...props, d: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6' })
    const ScreenGlyph = (props) => h(Glyph, { ...props, d: 'M3 5h18v11H3zM9 20h6M12 16v4' })

    /**
     * One request against the host half.
     * @param method - HTTP method.
     * @param path - route below the API prefix.
     * @param body - optional JSON body.
     * @returns the decoded response body.
     */
    async function request(method, path, body) {
      const response = await fetch(`/agent-scope/api${path}`, {
        method,
        headers: body === undefined
          ? { 'x-dsh-agent-scope': '1' }
          : { 'x-dsh-agent-scope': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const decoded = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (decoded?.ok !== true) throw new Error(decoded?.error ?? `HTTP ${response.status}`)
      return decoded
    }

    /**
     * Render one labelled field.
     *
     * The tools field passes `as: 'div'`: its own controls are labels, and a
     * label nested inside another label re-targets the outer one's activation
     * at the wrong checkbox.
     *
     * @param props - label, hint, the control, and an optional element kind.
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
     * follow the application theme, so in the dark theme the highlighted row
     * came out as white text on a light row and the options could not be read.
     * `Menu` is the control the rest of the Settings surface uses, and its
     * keyboard traversal and outside-click dismissal come with it.
     *
     * The twin of this component lives in `plugins/dsh-mcp-scope/src/client.js`:
     * a Dynamic Client bundle is one file, so neither can import the other.
     * This one also renders heading rows, which is how a grouped option list
     * keeps the provider headings its `<optgroup>` used to draw.
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
        items: options.map(option => option.heading === true
          ? { type: 'label', id: option.value, text: option.label }
          : { id: option.value, label: option.label }),
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
          h('span', { style: { display: 'flex', flexShrink: 0 } }, h(IconChevronDownOutline14))),
      })
      // `Menu` wraps its anchor in an inline-flex pill, so a block-level
      // dropdown stretches that wrapper through a column flex container
      // instead of a width rule the wrapper would ignore.
      return props.block === true
        ? h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, dropdown)
        : dropdown
    }

    /**
     * Render the switch used by the enable and injection toggles.
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
     * The tile that stands in for a sub-agent's avatar, carrying its colour marker.
     * @param props - the marker colour and the glyph.
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
      h('span', {
        style: {
          position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: 999,
          background: props.color || 'currentColor',
        },
      }))
    }

    /**
     * The create/edit form.
     * @param props - form props.
     * @returns the form element.
     */
    function AgentForm(props) {
      const { t, workspaces, availableTools, models, defaultScope, initial, onSubmit, onCancel } = props
      const editing = initial !== undefined
      const [name, setName] = useState(initial?.name ?? '')
      const [color, setColor] = useState(initial?.color ?? COLORS[5])
      const [scope, setScope] = useState(initial?.scope ?? defaultScope ?? 'global')
      const [route, setRoute] = useState(
        initial?.model === undefined || initial.model === null
          ? ''
          : `${initial.model.provider}\u0000${initial.model.model}`)
      const [description, setDescription] = useState(initial?.description ?? '')
      const [toolMode, setToolMode] = useState(initial?.tools?.mode ?? 'all')
      const [allowed, setAllowed] = useState(() => new Set(initial?.tools?.allow ?? []))
      const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '')
      const [inject, setInject] = useState(initial?.injectAgentsMd === true)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState('')

      const toggleTool = (toolName) => {
        setAllowed((current) => {
          const next = new Set(current)
          if (next.has(toolName)) next.delete(toolName)
          else next.add(toolName)
          return next
        })
      }

      const submit = async () => {
        setBusy(true)
        setFailure('')
        try {
          const at = route.indexOf('\u0000')
          const agent = {
            name: name.trim(),
            color,
            scope,
            description,
            systemPrompt,
            injectAgentsMd: inject,
            enabled: initial?.enabled !== false,
            model: at < 0 ? null : { provider: route.slice(0, at), model: route.slice(at + 1) },
            tools: toolMode === 'all'
              ? { mode: 'all', allow: [] }
              : { mode: 'custom', allow: [...allowed] },
          }
          await onSubmit(agent)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      const scopeChoices = [
        { value: 'global', label: t('global') },
        ...workspaces.map(workspace =>
          ({ value: workspace.path, label: `${t('workspace')} · ${workspace.title}` })),
        // The toolbar can be filtered to a scope the registry no longer lists,
        // and a definition created from there still starts in it.
        ...(defaultScope !== undefined && defaultScope !== 'global'
          && !workspaces.some(workspace => workspace.path === defaultScope)
          ? [{ value: defaultScope, label: `${t('workspace')} · ${defaultScope}` }]
          : []),
      ]

      // Providers become heading rows, which is what `<optgroup>` was doing.
      const routeChoices = [
        { value: '', label: t('modelInherit') },
        ...(models?.providers ?? []).flatMap(provider => [
          { value: `\u0000${provider.id}`, label: provider.name, heading: true },
          ...provider.models.map(model => ({
            value: `${provider.id}\u0000${model.id}`,
            label: `${provider.id}/${model.name}`,
          })),
        ]),
      ]

      const toolModeButton = (mode) => h('button', {
        key: mode,
        type: 'button',
        onClick: () => setToolMode(mode),
        style: {
          ...buttonStyle, borderRadius: 999, padding: '5px 14px', fontSize: 12,
          background: toolMode === mode ? 'color-mix(in srgb, currentColor 16%, transparent)' : 'transparent',
          fontWeight: toolMode === mode ? 600 : 400,
        },
      }, mode === 'all' ? t('toolsAll') : t('toolsCustom'))

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

        h('div', { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1 1 160px', minWidth: 0 } },
            h(Field, { label: t('fieldName'), hint: editing ? undefined : t('fieldNameHint') },
              h('input', {
                style: { ...fieldStyle, ...(editing ? { opacity: 0.6 } : {}) },
                value: name,
                disabled: editing,
                placeholder: 'code-reviewer',
                onChange: event => setName(event.target.value.toLowerCase()),
              }))),
          h('div', { style: { flex: '0 0 auto' } },
            h(Field, { label: t('fieldColor') },
              h('div', { style: { display: 'flex', gap: 6, paddingTop: 6 } },
                COLORS.map(swatch => h('button', {
                  key: swatch,
                  type: 'button',
                  'aria-label': swatch,
                  onClick: () => setColor(swatch),
                  style: {
                    width: 20, height: 20, borderRadius: 999, background: swatch, cursor: 'pointer', padding: 0,
                    border: color === swatch ? '2px solid currentColor' : '2px solid transparent',
                  },
                }))))),
          h('div', { style: { flex: '1 1 160px', minWidth: 0 } },
            h(Field, { label: t('fieldModel'), hint: t('modelHint') },
              h(Select, {
                options: routeChoices,
                value: route,
                onChange: setRoute,
                ariaLabel: t('fieldModel'),
                block: true,
              })))),

        h(Field, { label: t('fieldDescription') },
          h('input', {
            style: fieldStyle,
            value: description,
            placeholder: t('descriptionPlaceholder'),
            onChange: event => setDescription(event.target.value),
          })),

        h(Field, { as: 'div', label: t('fieldTools'), hint: t('toolsHint') },
          h('div', null,
            h('div', {
              style: {
                display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, border,
                marginBottom: toolMode === 'custom' ? 12 : 0,
              },
            }, toolModeButton('all'), toolModeButton('custom')),
            toolMode !== 'custom'
              ? null
              : availableTools.length === 0
                ? h('div', { style: { fontSize: 12, opacity: 0.6 } }, t('toolsNone'))
                : h('div', {
                  style: {
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 6, border, borderRadius: 12, padding: '12px 14px',
                    maxHeight: 260, overflow: 'auto',
                  },
                }, availableTools.map(toolName => h('label', {
                  key: toolName,
                  style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' },
                },
                h('input', {
                  type: 'checkbox',
                  checked: allowed.has(toolName),
                  onChange: () => toggleTool(toolName),
                }),
                h('span', { style: { fontFamily: 'ui-monospace, monospace' } }, toolName)))))),

        h(Field, { label: t('fieldSystemPrompt') },
          h('textarea', {
            style: { ...fieldStyle, minHeight: 110, resize: 'vertical' },
            value: systemPrompt,
            placeholder: t('systemPromptPlaceholder'),
            onChange: event => setSystemPrompt(event.target.value),
          })),

        h('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            border, borderRadius: 12, padding: '12px 14px', marginBottom: 18,
          },
        },
        h('div', null,
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('fieldInject')),
          h('div', { style: { fontSize: 11, opacity: 0.5, marginTop: 3 } }, t('injectHint')),
          initial === undefined
            ? null
            : h('div', { style: { fontSize: 11, opacity: 0.5, marginTop: 3, fontFamily: 'ui-monospace, monospace' } },
              `${initial.instructionFile?.exists === true ? t('instructionFound') : t('instructionMissing')}: ${initial.instructionFile?.path ?? ''}`)),
        h(Switch, { checked: inject, onChange: setInject })),

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
     * One installed sub-agent row.
     * @param props - the record, its title lookup, and the row actions.
     * @returns the row element.
     */
    function AgentRow(props) {
      const { t, agent, pending, onEdit, onToggle, onRemove } = props
      const badges = [
        h('span', {
          key: 'command',
          style: { ...chipStyle, fontFamily: 'ui-monospace, monospace' },
          title: t('commandChipHint'),
        }, `/${agent.name}`),
        h('span', {
          key: 'model',
          style: chipStyle,
          // The chip carries the model name alone; the hover text keeps the
          // provider reachable for a route whose model id contains a slash.
          title: agent.model === null ? undefined : `${agent.model.provider}/${agent.model.model}`,
        }, agent.model === null ? t('modelInherited') : agent.model.model),
        h('span', { key: 'tools', style: chipStyle },
          agent.tools?.mode === 'custom'
            ? `${(agent.tools.allow ?? []).length} ${t('toolsBadge')}`
            : t('toolsAllBadge')),
      ]
      if (agent.injectAgentsMd) {
        const present = agent.instructionFile?.exists === true
        badges.push(h('span', {
          key: 'agents',
          style: { ...chipStyle, color: present ? undefined : '#e5484d', opacity: present ? 0.75 : 0.9 },
        }, present ? t('injectBadge') : t('injectBadgeMissing')))
      }
      if (agent.mounted && (agent.sessions ?? 0) > 0) {
        badges.push(h('span', {
          key: 'sessions',
          style: { ...chipStyle, border: 'none', padding: 0, opacity: 0.5 },
        }, `${agent.sessions} ${t('sessions')}`))
      }
      const scopeBadge = agent.scope === 'global' ? t('global') : `${t('workspace')} · ${props.titleOf(agent.scope)}`

      return h('div', {
        role: 'button',
        tabIndex: 0,
        title: t('edit'),
        onClick: onEdit,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onEdit()
          }
        },
        style: {
          display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
          border, borderRadius: 12, marginBottom: 10, cursor: 'pointer',
          opacity: agent.enabled ? 1 : 0.55,
        },
      },
      h(Tile, { color: agent.color }, h(BotGlyph, { size: 21 })),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600, fontSize: 14 } }, agent.name),
          h('span', { style: chipStyle }, scopeBadge),
          ...badges),
        agent.description === ''
          ? null
          : h('div', {
            style: {
              fontSize: 12.5, opacity: 0.6, marginTop: 6, lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            },
          }, agent.description),
        agent.mountError === null || agent.mountError === undefined
          ? null
          : h('div', { style: { fontSize: 12, color: '#e5484d', marginTop: 6 } },
            `${t('mountError')}: ${agent.mountError}`)),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        h(Switch, {
          checked: agent.enabled,
          title: agent.enabled ? t('disabled') : t('enabled'),
          onChange: () => onToggle(),
        }),
        h('button', {
          type: 'button',
          title: pending ? t('confirmRemove') : t('remove'),
          onClick: (event) => {
            event.stopPropagation()
            onRemove()
          },
          style: {
            ...iconButtonStyle,
            width: 'auto', padding: pending ? '0 10px' : 0,
            color: pending ? '#e5484d' : 'inherit',
            opacity: pending ? 1 : 0.6,
          },
        }, h(TrashGlyph, { size: 16 }), pending ? h('span', { style: { fontSize: 12 } }, t('confirmRemove')) : null)))
    }

    /**
     * The Settings page.
     * @param props - injected props plus the bound dictionary.
     * @returns the page element.
     */
    function ScopeSection(props) {
      const { t, load, create, update, toggle, remove } = props
      const [state, setState] = useState(undefined)
      const [failure, setFailure] = useState('')
      const [form, setForm] = useState(undefined)
      const [pending, setPending] = useState('')
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

      useEffect(() => { void refresh() }, [refresh])

      const workspaces = state?.workspaces ?? []
      const titleOf = useMemo(() => {
        const index = new Map(workspaces.map(workspace => [workspace.path, workspace.title]))
        return path => index.get(path) ?? path
      }, [workspaces])

      const run = async (work) => {
        try {
          setPending('')
          await work()
          await refresh()
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }

      const agents = state?.agents ?? []
      const needle = query.trim().toLowerCase()
      const matches = (name, description) => needle === ''
        || name.toLowerCase().includes(needle)
        || (description ?? '').toLowerCase().includes(needle)
      // The toolbar count answers the scope filter alone; the section count also
      // answers the search box, so the two differ only while searching.
      const inScope = agents.filter(agent => agent.scope === scopeFilter)
      const visible = inScope.filter(agent => matches(agent.name, agent.description))

      if (form !== undefined) {
        return h('div', { style: { padding: '4px 2px' } },
          h(AgentForm, {
            t,
            workspaces,
            availableTools: state?.availableTools ?? [],
            models: state?.models,
            // A definition created while the list is filtered to one workspace
            // starts in it: the filter is what the person is looking at.
            defaultScope: scopeFilter,
            initial: form === null ? undefined : form,
            onCancel: () => setForm(undefined),
            onSubmit: async (agent) => {
              if (form === null) await create(agent)
              else await update(agent.name, agent)
              setForm(undefined)
              await refresh()
            },
          }))
      }

      const scopeChoices = [
        { value: 'global', label: t('global') },
        // Registered workspaces first, then any other scope a definition
        // already stores: a scope survives its workspace leaving the registry,
        // and a filter that could not reach it would hide the definition.
        ...[...new Set([
          ...workspaces.map(workspace => workspace.path),
          ...agents.map(agent => agent.scope).filter(scope => scope !== 'global'),
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
          h('div', { style: { fontSize: 13, opacity: 0.75 } }, `${t('count')} ${state === undefined ? 0 : inScope.length}`),
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
            }, h(PlusGlyph, { size: 15 }), t('newAgent')))),

        state === undefined
          ? h('div', { style: { opacity: 0.6, fontSize: 13 } }, t('loading'))
          : visible.length === 0
            ? h('div', { style: { opacity: 0.6, fontSize: 13, padding: '10px 0 18px' } },
              agents.length === 0 ? t('empty') : t('emptyFiltered'))
            : visible.map(agent => h(AgentRow, {
              key: agent.name,
              t,
              agent,
              titleOf,
              pending: pending === agent.name,
              onEdit: () => setForm(agent),
              onToggle: () => { void run(() => toggle(agent.name, !agent.enabled)) },
              onRemove: () => {
                if (pending !== agent.name) {
                  setPending(agent.name)
                  return
                }
                void run(() => remove(agent.name))
              },
            })),

        h('div', { style: { fontSize: 11, opacity: 0.45, marginTop: 18, lineHeight: 1.7 } },
          h('div', { style: { fontFamily: 'ui-monospace, monospace' } }, `${t('storeAt')}: ${state?.storePath ?? '…'}`),
          h('div', null, t('footerHint'))),
      )
    }

    /** Services the page reads. */
    const inject = ['slots', 'locale']

    /**
     * Open the Session a sub-agent command ran in.
     *
     * A command issued from a Session the panel has not opened — the
     * new-Session composer is the common case — appends its `command/run`,
     * `command/done`, and child rows to that Session's log without moving the
     * panel there, so the person sees the sidebar mark the Session running and
     * nothing else. The command's own row is the evidence they asked for, so a
     * command naming one of this plugin's definitions opens its Session.
     *
     * The definition names are read once and re-read on an unrecognized
     * command, which is also how a definition created in another tab starts
     * being followed without a reload.
     *
     * @param ctx - the client plugin context.
     * @returns the event disposer.
     */
    function followSubagentCommands(ctx) {
      let names = new Set()
      const refresh = async () => {
        try {
          const state = await request('GET', '/state')
          names = new Set((state.agents ?? []).map(agent => agent.name))
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
          // Open the Session the command ran in, then re-read the baseline: the
          // host decides whether a Session counts as blank, and its verdict for
          // this one (`command/run` is content) only reaches the client mirror
          // through a refresh. Until it does, the panel keeps rendering the
          // empty-Session hero over the command's own row.
          ctx.get('uiWorkspace')?.openSession?.(sessionId)
          void ctx.get('sessions')?.refresh?.()
        } catch {
          // Navigation is best-effort: the command already ran, and the Session
          // stays reachable from the sidebar when the browser refuses to move.
        }
      })
    }

    /**
     * Register the Settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-agent-scope: dictionaries')
      ctx.effect(() => followSubagentCommands(ctx), 'dsh-agent-scope: follow sub-agent commands')
      const t = ctx.locale.bind(NS)
      const injected = () => ({
        load: () => request('GET', '/state'),
        create: agent => request('POST', '/agents/create', { agent }),
        update: (name, agent) => request('POST', '/agents/update', { name, agent }),
        toggle: (name, enabled) => request('POST', '/agents/toggle', { name, enabled }),
        remove: name => request('POST', '/agents/delete', { name }),
      })
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'agent-scope',
        order: 17,
        label: () => t('nav'),
        locale: NS,
        inject: injected,
      }, ScopeSection))
    }

    exports.name = 'dsh-agent-scope'
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
