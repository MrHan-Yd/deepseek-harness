/**
 * dsh-git-tools browser half: one floating git panel at the frame's top-right.
 *
 * It is registered into `shell.overlay` — the frame-wide floating layer whose
 * entries opt back into pointer events — and anchors itself to the corner. The
 * checkout it acts on is the one the Session the frame is showing runs in. That
 * Session is read from the sessions snapshot the slot hands it: the main view is
 * what retains a Session (`retainedBy.mainView`), so its reference moving is
 * what switching Sessions looks like from here, and the panel follows it.
 *
 * Collapsed, the panel is the branch alone. Expanded, it is the branch, the
 * commit message, and the three actions the Host offers: commit, commit and
 * push, push. Nothing polls: the state is read whenever the shown Session
 * changes, and after each command.
 *
 * Shipped as a Dynamic Client bundle without a build step, like the sibling
 * fork plugins: the factory takes `react` and the shared primitives from the
 * platform module table and builds every element with `createElement`.
 *
 * @module dsh-git-tools/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-tools',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { IconChevronDownOutlineRegular, Menu } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')

    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'gitTools'

    /**
     * The animations these inline styles need: keyframes cannot be declared from
     * a style attribute, so the panel ships them as one stylesheet — installed
     * while the plugin is mounted, removed with it. The marker attribute is what
     * lets reduced-motion switch every one of them off, which an inline
     * `animation` shorthand cannot be talked out of on its own.
     */
    const STYLE_ID = 'dsh-git-tools-styles'
    const ANIMATED = 'data-dsh-git-tools-animated'
    const SPIN = 'dsh-git-tools-spin'
    const OPEN = 'dsh-git-tools-open'
    const CLOSE = 'dsh-git-tools-close'
    const DIALOG = 'dsh-git-tools-dialog'
    const VEIL = 'dsh-git-tools-veil'
    const STYLES = [
      `@keyframes ${SPIN}{to{transform:rotate(360deg)}}`,
      `@keyframes ${OPEN}{from{opacity:0;transform:translateY(-6px) scale(.96)}}`,
      `@keyframes ${CLOSE}{to{opacity:0;transform:translateY(-6px) scale(.96)}}`,
      // The dialog is centred by its own transform, so its first frame has to
      // restate it; a bare scale would drop the centring for the whole animation.
      `@keyframes ${DIALOG}{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}}`,
      `@keyframes ${VEIL}{from{opacity:0}}`,
      `@media (prefers-reduced-motion: reduce){[${ANIMATED}]{animation:none!important}}`,
    ].join('')

    /** How long collapsing takes, matching the close animation below. */
    const COLLAPSE_MS = 150
    /** How long unfolding takes. */
    const UNFOLD_MS = 160

    /** How long a surface that hangs off the card takes to arrive. */
    const SURFACE_MS = 140

    /**
     * How long to wait before re-asking for a Session the Host has not opened.
     *
     * One retry, once, for a Session the page named while its Agent was still
     * coming up — never a poll: the second answer settles the card either way.
     */
    const PENDING_RETRY_MS = 400

    const zh = {
      title: 'Git 工具',
      expand: '展开 Git 工具',
      collapse: '收起',
      commitPushEntry: '提交或推送',
      branches: '分支',
      searchBranch: '搜索分支',
      createBranch: '创建并检出新分支…',
      newBranchPlaceholder: '新分支名',
      commitShortcut: 'Ctrl+↵',
      branch: '分支',
      switchBranch: '切换分支',
      current: '当前分支',
      commitMessage: '提交信息',
      messagePlaceholder: '提交信息（留空将自动生成）',
      generate: '生成提交信息',
      commitLanguage: '提交信息语言',
      commitLanguageHint: '生成提交信息时使用哪种语言',
      languageAuto: '跟随界面',
      languageZh: '中文',
      languageEn: 'English',
      stageAll: '包含未暂存的更改',
      skipHooks: '跳过 Git hooks（--no-verify）',
      skipHooksWarn: '将绕过仓库自己的提交检查。',
      files: '个文件',
      clean: '没有未提交的更改',
      uncommitted: '未提交的更改',
      commit: '提交',
      commitPush: '提交并推送',
      push: '推送',
      working: '执行中…',
      noRepo: '这个工作区不是 git 仓库',
      failed: '操作失败',
      loadFailed: '读取 git 状态失败',
    }

    const en = {
      title: 'Git tools',
      expand: 'Open Git tools',
      collapse: 'Collapse',
      commitPushEntry: 'Commit or push',
      branches: 'Branches',
      searchBranch: 'Search branches',
      createBranch: 'Create and check out…',
      newBranchPlaceholder: 'New branch name',
      commitShortcut: 'Ctrl+↵',
      branch: 'Branch',
      switchBranch: 'Switch branch',
      current: 'Current branch',
      commitMessage: 'Commit message',
      messagePlaceholder: 'Commit message (written when left empty)',
      generate: 'Write the commit message',
      commitLanguage: 'Commit message language',
      commitLanguageHint: 'Which language a written commit message uses',
      languageAuto: 'Follow the interface',
      languageZh: '中文',
      languageEn: 'English',
      stageAll: 'Include unstaged changes',
      skipHooks: 'Skip Git hooks (--no-verify)',
      skipHooksWarn: 'This bypasses the repository’s own commit checks.',
      files: 'files',
      clean: 'No uncommitted changes',
      uncommitted: 'Uncommitted changes',
      commit: 'Commit',
      commitPush: 'Commit & push',
      push: 'Push',
      working: 'Working…',
      noRepo: 'This workspace is not a git repository',
      failed: 'Failed',
      loadFailed: 'Could not read git status',
    }

    /**
     * The panel's surface. `bg-layer-2` is the theme's elevated layer — in the
     * dark theme `rgb(44, 44, 46)`, the panel colour the reference draws. The
     * overlay alias is a mid-grey scrim and reads far too light.
     */
    const surface = 'var(--dsw-alias-bg-layer-2)'
    const border = '1px solid var(--dsw-alias-border-l1)'
    const strongBorder = '1px solid var(--dsw-alias-border-l2)'
    const labelPrimary = 'var(--dsw-alias-label-primary)'
    const labelSecondary = 'var(--dsw-alias-label-secondary)'

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

    const BranchGlyph = (props) => h(Glyph, {
      ...props,
      d: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9v1a4 4 0 0 1-4 4H6',
    })
    const CollapseGlyph = (props) => h(Glyph, { ...props, d: 'M6 15l6-6 6 6' })
    const CheckGlyph = (props) => h(Glyph, { ...props, d: 'M20 6L9 17l-5-5' })
    const SparkleGlyph = (props) => h(Glyph, {
      ...props,
      d: 'M10 3l1.7 4.8L16.5 9.5l-4.8 1.7L10 16l-1.7-4.8L3.5 9.5l4.8-1.7zM18 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
    })
    const PlusGlyph = (props) => h(Glyph, { ...props, d: 'M12 5v14M5 12h14' })
    const CommitGlyph = (props) => h(Glyph, { ...props, d: 'M12 3v12M12 15l-4-4M12 15l4-4M5 19h14' })
    const PushGlyph = (props) => h(Glyph, { ...props, d: 'M12 21V9M12 9l-4 4M12 9l4 4M5 5h14' })

    /**
     * Group a line count the way the reference prints it: 3,145.
     * @param value - the count.
     * @returns the grouped text.
     */
    function grouped(value) {
      return Number(value ?? 0).toLocaleString('en-US')
    }

    /**
     * One request against the host half.
     * @param method - HTTP method.
     * @param path - route below the API prefix.
     * @param body - optional JSON body.
     * @returns the decoded response body.
     */
    async function request(method, path, body) {
      const response = await fetch(`/git-tools/api${path}`, {
        method,
        headers: body === undefined
          ? { 'x-dsh-git-tools': '1' }
          : { 'x-dsh-git-tools': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const decoded = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (decoded?.ok !== true) throw new Error(decoded?.error ?? `HTTP ${response.status}`)
      return decoded
    }

    /**
     * The Session the frame is showing.
     *
     * A frame-level entry is handed no Session prop, and the Session list
     * carries no selection field. What it does carry is who retains what: the
     * main view retains exactly the Session it displays, under the `mainView`
     * source. Switching Sessions releases one and takes the other, so this is
     * read live, and the panel re-reads with it.
     *
     * @param list - the Session list snapshot the slot hook selects over.
     * @returns the shown Session's id, or undefined when none is shown.
     */
    function shownSessionId(list) {
      const rows = list?.byId
      if (rows === undefined) return undefined
      return Object.values(rows).find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id
    }

    /**
     * The floating panel.
     * @param props - the injected face, the store seat, and the shown Session.
     * @returns the panel element.
     */
    function GitPanel(props) {
      const { t, useSessions, language, useStore } = props
      const commitLanguage = useStore(selection => selection.choice)
      const [open, setOpen] = useState(false)
      const [view, setView] = useState('none')
      const [query, setQuery] = useState('')
      const [newBranchOpen, setNewBranchOpen] = useState(false)
      const [newBranch, setNewBranch] = useState('')
      const [state, setState] = useState(undefined)
      const [message, setMessage] = useState('')
      const [stageAll, setStageAll] = useState(true)
      const [skipHooks, setSkipHooks] = useState(false)
      const [busy, setBusy] = useState(false)
      const [writing, setWriting] = useState(false)
      const [note, setNote] = useState('')
      // Collapsing plays out before the card goes: the element has to stay
      // mounted for its own animation, so the close is a state, not a swap.
      const [closing, setClosing] = useState(false)
      const collapseTimer = useRef(0)

      /**
       * Fold the card back into the pill, after the animation has played.
       * @returns nothing.
       */
      const collapse = useCallback(() => {
        setView('none')
        setClosing(true)
        collapseTimer.current = window.setTimeout(() => {
          setClosing(false)
          setOpen(false)
        }, COLLAPSE_MS)
      }, [])

      useEffect(() => () => { window.clearTimeout(collapseTimer.current) }, [])

      const describe = (error) => (error instanceof Error ? error.message : String(error))
      // Live: the frame's main view moving is what a Session switch is.
      const sessionId = useSessions(shownSessionId)
      /** One read per Session, kept so switching back shows numbers at once. */
      const states = useRef(new Map())
      /** The Session the frame shows now, for an answer that lands after a switch. */
      const frameSession = useRef(sessionId)
      useEffect(() => { frameSession.current = sessionId }, [sessionId])

      /**
       * Show one read, and file it under the Session it was issued for.
       *
       * A late answer is still cached, but shown only while the frame is still
       * on that Session: one checkout's numbers are never rendered under
       * another's name.
       *
       * @param owner - the Session the read was issued for.
       * @param next - the state the Host answered.
       */
      const publish = (owner, next) => {
        if (owner !== undefined) states.current.set(owner, next)
        if (owner === frameSession.current) setState(next)
      }

      // Read on arrival and whenever the shown Session changes; nothing repeats
      // on a timer. What this Session read last is shown first — a switch is a
      // refresh, not a blank card.
      useEffect(() => {
        setView('none')
        setNote('')
        setState(sessionId === undefined ? undefined : states.current.get(sessionId))
        let cancelled = false
        let retry
        const read = async () => {
          try {
            const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
            const next = await request('GET', `/state${query}`)
            if (cancelled) return
            if (next.pending === true) {
              retry = window.setTimeout(() => { void read() }, PENDING_RETRY_MS)
              return
            }
            publish(sessionId, next)
            setNote('')
          } catch (error) {
            if (!cancelled) setNote(`${t('loadFailed')}: ${describe(error)}`)
          }
        }
        void read()
        return () => {
          cancelled = true
          window.clearTimeout(retry)
        }
      }, [t, sessionId])

      // Escape closes whichever surface is open, so neither one is a trap. It
      // sits above the collapsed return: every render must call the same hooks.
      useEffect(() => {
        if (view === 'none') return undefined
        const onKey = (event) => { if (event.key === 'Escape') setView('none') }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [view])

      const run = async (work) => {
        setBusy(true)
        setNote('')
        try {
          const next = await work()
          if (next !== undefined) publish(sessionId, next)
        } catch (error) {
          setNote(describe(error))
        } finally {
          setBusy(false)
        }
      }

      const checkout = (branch) => run(async () => {
        const next = await request('POST', '/checkout', { sessionId, branch })
        setView('none')
        return next
      })

      const createBranch = (branch) => run(async () => {
        const next = await request('POST', '/create-branch', { sessionId, branch })
        setNewBranch('')
        setNewBranchOpen(false)
        setView('none')
        return next
      })

      /**
       * Have the Host write a message and put it in the box.
       * @returns the message text.
       */
      const write = async () => {
        setWriting(true)
        try {
          // The chosen language, or the one this panel is showing.
          const asked = commitLanguage === LANGUAGE_CHOICES[0] ? language() : commitLanguage
          const written = await request('POST', '/message', { sessionId, stageAll, locale: asked })
          setMessage(written.message)
          return written.message
        } finally {
          setWriting(false)
        }
      }

      /**
       * The sparkle: write a message now, without committing anything. The text
       * stays in the box — it must not travel back as a new git state.
       */
      const generate = () => run(async () => { await write() })

      /**
       * The message to commit with: what was typed, or one the Host's model
       * writes when the box was left empty.
       * @returns the message text.
       */
      const messageFor = async () => (message.trim() !== '' ? message : await write())

      const commit = (push) => run(async () => {
        const text = await messageFor()
        const next = await request('POST', '/commit', { sessionId, message: text, stageAll, skipHooks })
        setMessage('')
        return push ? await request('POST', '/push', { sessionId }) : next
      })

      const push = () => run(() => request('POST', '/push', { sessionId }))

      const branch = state?.branch ?? null
      const repo = state?.repo === true
      const changed = state?.changedFiles ?? 0
      const insertions = state?.insertions ?? 0
      const deletions = state?.deletions ?? 0
      // The Host decides the directory, so the panel names it: acting on another
      // checkout without saying so would be worse than showing nothing.
      const where = typeof state?.cwd === 'string' ? state.cwd : ''

      /**
       * The working tree's line tally, carried by the collapsed pill and the
       * card's header alike so the counts read the same in either state.
       * Nothing to tally — a clean tree, or changes that carry no lines at all —
       * shows nothing rather than a zero.
       * @returns the chip element, or null.
       */
      const tally = () => (insertions + deletions > 0
        ? h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px',
            border, borderRadius: 999, background: 'color-mix(in srgb, currentColor 6%, transparent)',
            fontSize: 11.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          },
        },
          h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, `+${grouped(insertions)}`),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `-${grouped(deletions)}`))
        : null)

      // Just below the frame's own chrome — its conversation header's bottom
      // border sits about 75px down — and in from the right edge, where the
      // frame's scrollbar is.
      const anchor = { position: 'fixed', top: 82, right: 48, zIndex: 40, pointerEvents: 'auto' }

      if (!open) {
        return h('button', {
          type: 'button',
          title: where === '' ? t('expand') : `${t('expand')} — ${where}`,
          'aria-label': t('expand'),
          onClick: () => { setOpen(true) },
          [ANIMATED]: '',
          style: {
            ...anchor,
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px',
            border, borderRadius: 999, background: surface, color: labelSecondary,
            font: 'inherit', fontSize: 12.5, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,.18)',
            // It grows back out of the corner the card sits in.
            transformOrigin: 'top right',
            animation: `${OPEN} ${UNFOLD_MS}ms ease-out`,
          },
        },
        h(BranchGlyph, { size: 14 }),
        h('span', { style: { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          state === undefined ? t('title') : (repo ? (branch ?? t('title')) : t('noRepo'))),
        tally())
      }

      const disabled = busy || !repo
      const matching = (state?.branches ?? []).filter(name => name.toLowerCase().includes(query.trim().toLowerCase()))
      // The branch in use leads the list, as the reference draws it; the rest
      // keep the order git printed.
      const shown = branch === null || !matching.includes(branch)
        ? matching
        : [branch, ...matching.filter(name => name !== branch)]
      const pickingBranch = view === 'branch'
      const committing = view === 'commit'
      // Nothing to publish: the branch tracks an upstream and is level with it.
      // An unknown count (no upstream at all) leaves the push available.
      const pushable = !(state?.ahead === 0)

      /**
       * One row: the icon, the label with an optional second line, and an
       * optional right-hand value.
       * @param props - the row's parts.
       * @returns the row element.
       */
      const row = (props) => h('button', {
        type: 'button',
        'aria-label': props.ariaLabel ?? props.label,
        disabled: props.disabled === true,
        onClick: props.onClick,
        style: {
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
          border: 'none', background: props.active === true ? 'color-mix(in srgb, currentColor 8%, transparent)' : 'transparent',
          color: 'inherit', font: 'inherit', fontSize: 12.5, textAlign: 'left',
          cursor: props.disabled === true ? 'default' : 'pointer',
          opacity: props.disabled === true ? 0.5 : 1,
        },
      },
      h('span', { style: { display: 'flex', flexShrink: 0, opacity: 0.7 } }, props.icon),
      h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.label),
        props.hint === undefined
          ? null
          : h('span', {
            style: { fontSize: 11, opacity: 0.55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, props.hint)),
      props.value ?? null)

      /**
       * The commit box: a dialog over a dimmed frame, the way the reference
       * draws it — its own header row, the message, the staging switch, and the
       * three actions.
       */
      const commitDialog = h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('commitPushEntry'),
        [ANIMATED]: '',
        style: {
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 41,
          width: 460, border: strongBorder, borderRadius: 12, background: surface, color: labelPrimary,
          boxShadow: '0 24px 64px rgba(0,0,0,.5)', padding: 14, display: 'flex', flexDirection: 'column',
          gap: 10, fontSize: 12.5,
          animation: `${DIALOG} ${UNFOLD_MS}ms ease-out`,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('button', {
          type: 'button',
          title: t('switchBranch'),
          'aria-label': t('current'),
          onClick: () => { setView('branch') },
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 6px', marginLeft: -6,
            border: 'none', borderRadius: 6, background: 'transparent', color: 'inherit',
            font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          },
        },
          h('span', { style: { display: 'flex', opacity: 0.7 } }, h(BranchGlyph, { size: 14 })),
          branch ?? t('branch'),
          h('span', { style: { display: 'flex', opacity: 0.6 } }, h(IconChevronDownOutlineRegular))),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { display: 'inline-flex', gap: 6, fontVariantNumeric: 'tabular-nums' } },
          h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, `+${grouped(insertions)}`),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, `-${grouped(deletions)}`))),

      // The message, with the way to have one written on the right.
      h('div', { style: { position: 'relative' } },
        h('textarea', {
          value: message,
          placeholder: t('messagePlaceholder'),
          'aria-label': t('commitMessage'),
          autoFocus: true,
          onChange: event => setMessage(event.target.value),
          onKeyDown: (event) => {
            // Ctrl+Enter commits, the accelerator the reference prints.
            if (event.key !== 'Enter' || event.ctrlKey !== true) return
            event.preventDefault()
            void commit(false)
          },
          style: {
            width: '100%', boxSizing: 'border-box', minHeight: 150, padding: '8px 36px 8px 10px',
            resize: 'vertical', border: strongBorder, borderRadius: 8, background: 'transparent',
            color: 'inherit', font: 'inherit', fontSize: 12.5, outline: 'none',
          },
        }),
        h('button', {
          type: 'button',
          title: t('generate'),
          'aria-label': t('generate'),
          disabled: busy,
          onClick: () => { void generate() },
          style: {
            position: 'absolute', top: 7, right: 7, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', width: 24, height: 24, padding: 0, border: 'none', borderRadius: 6,
            background: 'transparent', color: labelSecondary,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          },
        },
        // The glyph itself is the progress: it turns while a message is written.
        h('span', {
          [ANIMATED]: '',
          style: {
            display: 'flex',
            ...(writing ? { animation: `${SPIN} .9s linear infinite` } : {}),
          },
        }, h(SparkleGlyph, { size: 15 })))),

      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: stageAll,
            onChange: event => setStageAll(event.target.checked),
          }),
          t('stageAll')),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { opacity: 0.6 } }, changed === 0 ? t('clean') : `${changed} ${t('files')}`)),

      // The one way to commit a repository whose hooks cannot start: Git for
      // Windows runs them through its own `sh.exe`, which a confined sandbox
      // refuses. It is asked for by hand, and says what it costs, because the
      // hooks are the repository's own gates.
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
        h('input', {
          type: 'checkbox',
          checked: skipHooks,
          onChange: event => setSkipHooks(event.target.checked),
        }),
        t('skipHooks')),
      skipHooks
        ? h('div', { style: { fontSize: 11, marginTop: -4, color: 'var(--dsw-alias-state-error-primary)' } },
          t('skipHooksWarn'))
        : null,

      note === '' ? null : h('div', {
        style: { whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary)' },
      }, note),

      h('div', { style: { border: strongBorder, borderRadius: 10, overflow: 'hidden' } },
        row({
          label: t('commit'),
          icon: h(CommitGlyph, { size: 14 }),
          ariaLabel: t('commit'),
          disabled,
          onClick: () => { void commit(false) },
          value: h('span', { style: { opacity: 0.5, fontSize: 11 } }, t('commitShortcut')),
        }),
        h('div', { style: { borderTop: border } }, row({
          label: t('commitPush'),
          icon: h(CommitGlyph, { size: 14 }),
          ariaLabel: t('commitPush'),
          disabled,
          onClick: () => { void commit(true) },
        })),
        h('div', { style: { borderTop: border } }, row({
          label: t('push'),
          icon: h(PushGlyph, { size: 14 }),
          ariaLabel: t('push'),
          disabled: disabled || !pushable,
          onClick: () => { void push() },
        }))))

      return h(React.Fragment, null,
        // The frame dims but the card stays crisp, so the veil is the card's
        // sibling rather than something inside it.
        committing
          ? h('div', {
            [ANIMATED]: '',
            style: {
              position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.45)', pointerEvents: 'auto',
              animation: `${VEIL} ${UNFOLD_MS}ms ease-out`,
            },
            onMouseDown: (event) => { if (event.target === event.currentTarget) setView('none') },
          })
          : null,

        h('div', {
        [ANIMATED]: '',
        style: {
          ...anchor,
          width: 268, border, borderRadius: 12, background: surface, color: labelPrimary,
          fontSize: 12.5, boxShadow: '0 10px 30px rgba(0,0,0,.28)',
          // The branch list hangs below the card, outside its own flow.
          overflow: 'visible',
          // It unfolds from the corner the pill sits in, and folds back into it.
          // While it folds it takes no clicks: it is on its way out.
          transformOrigin: 'top right',
          ...(closing ? { pointerEvents: 'none' } : {}),
          animation: closing
            ? `${CLOSE} ${COLLAPSE_MS}ms ease-in forwards`
            : `${OPEN} ${UNFOLD_MS}ms ease-out`,
        },
      },
      // Header, as the reference draws it: the title, then the way out.
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          borderRadius: '12px 12px 0 0',
          background: 'color-mix(in srgb, currentColor 6%, transparent)',
        },
      },
        h('span', { style: { flex: 1, minWidth: 0, fontWeight: 600 } }, t('title')),
        // The same tally the collapsed pill carries, so the panel answers "is
        // there anything to commit" without the dialog being opened.
        tally(),
        h('button', {
          type: 'button',
          title: t('collapse'),
          'aria-label': t('collapse'),
          disabled: closing,
          onClick: collapse,
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
            padding: 0, border: 'none', borderRadius: 6, background: 'transparent',
            color: labelSecondary, cursor: 'pointer',
          },
        }, h(CollapseGlyph, { size: 13 }))),

      // Nothing at all while the first read is in flight: a failed read must not
      // be dressed up as "this is not a repository".
      state === undefined
        ? null
        : repo
        ? h('div', { style: { padding: '2px 0 4px' } },
          // 分支: the row carries the list, which hangs to its left at the row.
          h('div', { style: { position: 'relative' } },
          row({
            label: branch ?? t('branch'),
            icon: h(BranchGlyph, { size: 14 }),
            ariaLabel: t('switchBranch'),
            active: view === 'branch',
            onClick: () => { setView(current => (current === 'branch' ? 'none' : 'branch')) },
            value: h('span', { style: { display: 'flex', opacity: 0.6 } }, h(IconChevronDownOutlineRegular)),
          }),
          // 提交或推送: opens the commit box.
          row({
            label: t('commitPushEntry'),
            icon: h(CommitGlyph, { size: 14 }),
            ariaLabel: t('commitPushEntry'),
            active: view === 'commit',
            onClick: () => { setView(current => (current === 'commit' ? 'none' : 'commit')) },
          }),

          // 分支: the list floats to the left of the card, level with the row.
          pickingBranch
            ? h('div', {
              [ANIMATED]: '',
              style: {
                position: 'absolute', top: 0, right: '100%', marginRight: 6, width: 300,
                maxHeight: 420, overflowY: 'auto', border: strongBorder, borderRadius: 10,
                background: surface, boxShadow: '0 12px 32px rgba(0,0,0,.34)', padding: '8px 0 4px',
                // It unfolds from the corner it shares with the row.
                transformOrigin: 'top right',
                animation: `${OPEN} ${SURFACE_MS}ms ease-out`,
              },
            },
              h('div', { style: { padding: '0 10px 6px' } },
                h('input', {
                  value: query,
                  placeholder: t('searchBranch'),
                  'aria-label': t('searchBranch'),
                  onChange: event => setQuery(event.target.value),
                  style: {
                    width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6,
                    border: strongBorder, background: 'transparent', color: 'inherit',
                    font: 'inherit', fontSize: 12, outline: 'none',
                  },
                })),
              h('div', { style: { padding: '0 10px 4px', fontSize: 11, opacity: 0.5 } }, t('branches')),
              ...shown.map(name => row({
                key: name,
                label: name,
                ariaLabel: name,
                icon: h(BranchGlyph, { size: 14 }),
                active: name === branch,
                // The branch in use says what the working tree still holds.
                hint: name === branch && changed > 0
                  ? `${t('uncommitted')}: ${changed} ${t('files')}`
                  : undefined,
                onClick: () => { void checkout(name) },
                value: name === branch
                  ? h('span', { style: { display: 'flex', opacity: 0.75 } }, h(CheckGlyph, { size: 14 }))
                  : null,
              })),
              h('div', { style: { borderTop: border, marginTop: 4, paddingTop: 4 } },
                newBranchOpen
                  ? h('div', { style: { padding: '0 10px 6px' } },
                    h('input', {
                      value: newBranch,
                      placeholder: t('newBranchPlaceholder'),
                      'aria-label': t('createBranch'),
                      onChange: event => { setNewBranch(event.target.value) },
                      onKeyDown: (event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void createBranch(newBranch)
                      },
                      style: {
                        width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6,
                        border: strongBorder, background: 'transparent', color: 'inherit',
                        font: 'inherit', fontSize: 12, outline: 'none',
                      },
                    }))
                  : row({
                    label: t('createBranch'),
                    icon: h(PlusGlyph, { size: 14 }),
                    ariaLabel: t('createBranch'),
                    disabled: busy,
                    onClick: () => { setNewBranchOpen(true) },
                  })))
            : null))
        : h('div', { style: { padding: 10, color: labelSecondary } }, t('noRepo')),

      where === ''
        ? null
        : h('div', {
          style: {
            borderTop: border, padding: '6px 10px', fontSize: 11, opacity: 0.45,
            fontFamily: 'ui-monospace, monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
          title: where,
        }, where),

      // The card says nothing while the dialog is up: the dialog is the work,
      // and its own spinner is the whole progress report.
      committing || busy === false ? null : h('div', {
        style: { padding: '0 10px 8px', color: labelSecondary },
      }, t('working')),
      committing || note === '' ? null : h('div', {
        style: {
          padding: '0 10px 8px', whiteSpace: 'pre-wrap',
          color: 'var(--dsw-alias-state-error-primary)',
        },
      }, note)),

      committing ? commitDialog : null)
    }

    /** Every commit-message language the row offers; the first is the default. */
    const LANGUAGE_CHOICES = ['auto', 'zh', 'en']

    /** Dictionary key naming one language choice. */
    const LANGUAGE_LABELS = { auto: 'languageAuto', zh: 'languageZh', en: 'languageEn' }

    /**
     * The General-settings row that chooses which language a written commit
     * message uses. It writes the shared store; the panel reads it.
     * @param props - the injected dictionary, the store seat, and the shared actions.
     * @returns the row element.
     */
    function CommitLanguageRow(props) {
      const { t, useStore, actions } = props
      const [open, setOpen] = useState(false)
      const choice = useStore(selection => selection.choice)
      const labelOf = id => t(LANGUAGE_LABELS[id] ?? LANGUAGE_LABELS.auto)

      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0',
          borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
        },
      },
      h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48 } },
        h('div', { style: { fontSize: 14, lineHeight: '22px', color: labelPrimary } }, t('commitLanguage')),
        h('div', { style: { fontSize: 12, lineHeight: '18px', color: labelSecondary } }, t('commitLanguageHint'))),
      h(Menu, {
        open,
        onClose: () => { setOpen(false) },
        items: LANGUAGE_CHOICES.map(id => ({ id, label: labelOf(id) })),
        selectedId: choice,
        onSelect: (id) => { actions.setLanguage(id); setOpen(false) },
        align: 'end',
        portal: true,
        anchor: h('button', {
          type: 'button',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': t('commitLanguage'),
          onClick: () => { setOpen(value => !value) },
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 12, height: 36, padding: '0 14px',
            border: 'none', borderRadius: 18, background: 'var(--dsw-alias-bg-module-platform)',
            color: labelPrimary, font: 'inherit', fontSize: 14, lineHeight: '22px', cursor: 'pointer',
          },
        },
        labelOf(choice),
        h('span', { style: { display: 'flex' } }, h(IconChevronDownOutlineRegular))),
      }))
    }

    /** Services the page reads. */
    const inject = ['slots', 'locale']

    /**
     * Register the floating git panel.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-tools: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = STYLES
        document.head.append(style)
        return () => { style.remove() }
      }, 'dsh-git-tools: panel animations')
      // The locale is read when a message is asked for, not captured here: the
      // person can switch language while the panel is mounted. The live locale
      // is the snapshot's `active` — the interface this panel is drawn in.
      const language = () => ctx.locale.getLocale().active
      const injected = () => ({ t, language })
      // One handle, two registrations: the row that chooses the language and the
      // panel that writes with it share the one persisted instance.
      const commitLanguage = defineStore({
        init: () => ({ choice: LANGUAGE_CHOICES[0] }),
        persist: 'dsh.git-tools.commit-language',
        actions: {
          setLanguage: (draft, id) => {
            if (LANGUAGE_CHOICES.includes(id)) draft.choice = id
          },
        },
      })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'git-tools',
        order: 40,
        label: () => t('title'),
        store: commitLanguage,
        inject: injected,
      }, GitPanel))
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'git-tools-commit-language',
        order: 5,
        store: commitLanguage,
        inject: injected,
      }, CommitLanguageRow))
    }

    exports.name = 'dsh-git-tools'
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
