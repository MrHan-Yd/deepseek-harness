/**
 * dsh-system-stats browser half: the machine readout under the composer.
 *
 * It registers one entry in `conversation.composer.dock`, the ambient row below
 * the composer card, at a negative order so it sits to the left of the Session
 * statistics `@deepseek-ai/dsh-client-ui-chat` already draws there.
 *
 * The entry is one pill, not three. CPU and memory are both a short percentage,
 * so they share one entry side by side; the network rates are long enough to
 * want the pill to themselves. The two entries alternate in the same fixed box
 * every few seconds, so the row keeps the width of one entry. Hovering or
 * focusing the pill holds the rotation on the entry under the pointer, and
 * clicking opens the stat dialog the Session pills use, with the entries'
 * exact figures: the busy share with its core count and sampling window,
 * memory used, available, and total, and the two interface rates.
 *
 * The Host owns when the machine is read: this half polls the metrics route on
 * the cadence the route reports, pauses while the page is hidden, and asks
 * immediately when the page becomes visible again. A refused or failed read
 * shows the readings as unavailable rather than leaving the previous numbers on
 * screen as if they were current.
 *
 * Shipped as a Dynamic Client bundle without a build step, like the sibling fork
 * plugins: the factory takes `react`, `react-dom`, and the shared primitives from
 * the platform module table and builds every element with `createElement`, so the
 * file in `src/` is the file a reviewer reads.
 *
 * @module dsh-system-stats/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-system-stats',
  factory: (require) => {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const { useAnchoredPosition, useDismissOnOutsidePointer } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const { useEffect, useLayoutEffect, useRef, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'systemStats'

    /** Same-origin route the Host half registers. */
    const API_PATH = '/system-stats/api/metrics'

    /** Header the Host half requires beside the deployment's own fence. */
    const GUARD_HEADER = 'x-dsh-system-stats'

    /** Cadence used until the Host reports its own, and after a failed read. */
    const DEFAULT_POLL_MS = 3000

    /** Floor for the reported cadence: a page must not outpace the machine's sampler. */
    const MIN_POLL_MS = 500

    /** How long one entry stays in the pill before the other one takes it. */
    const ROTATE_MS = 5000

    /** Viewport margin the dialog's placement clamp keeps (the shared pill dialog's own). */
    const PANEL_MARGIN = 12

    /** Distance between the pill's top edge and the dialog's bottom. */
    const PANEL_GAP = 8

    /** Unplaced portal panel: hidden but laid out so the clamp measures real dimensions. */
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    const zh = {
      cpuTitle: 'CPU',
      memoryTitle: '内存',
      networkTitle: '网络',
      dialogLabel: '系统状态详情',
      rowUsage: '使用率',
      rowCores: '核心数',
      rowWindow: '采样窗口',
      rowUsed: '已用',
      rowAvailable: '可用',
      rowTotal: '总计',
      rowDown: '下行',
      rowUp: '上行',
      networkUnavailableDetail: '此平台不提供网络字节计数',
      readFailedDetail: '读取系统状态失败',
      windowMilliseconds: '{milliseconds} 毫秒',
      windowSeconds: '{seconds} 秒',
      unavailable: '—',
      byte: '{value} B',
      kilobyte: '{value} KB',
      megabyte: '{value} MB',
      gigabyte: '{value} GB',
      terabyte: '{value} TB',
      perSecond: '{rate}/s',
      percent: '{value}%',
    }

    const en = {
      cpuTitle: 'CPU',
      memoryTitle: 'Memory',
      networkTitle: 'Network',
      dialogLabel: 'System state details',
      rowUsage: 'In use',
      rowCores: 'Cores',
      rowWindow: 'Sampled over',
      rowUsed: 'Used',
      rowAvailable: 'Available',
      rowTotal: 'Total',
      rowDown: 'Download',
      rowUp: 'Upload',
      networkUnavailableDetail: 'Network byte counters are unavailable on this platform',
      readFailedDetail: 'System state could not be read',
      windowMilliseconds: '{milliseconds} ms',
      windowSeconds: '{seconds} s',
      unavailable: '—',
      byte: '{value} B',
      kilobyte: '{value} KB',
      megabyte: '{value} MB',
      gigabyte: '{value} GB',
      terabyte: '{value} TB',
      perSecond: '{rate}/s',
      percent: '{value}%',
    }

    /** Byte units in ascending order, matching the dictionary's one key each. */
    const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

    /** Bytes in one step between two adjacent byte units. */
    const UNIT_STEP = 1024

    /**
     * The pill's anchor: shrink-wraps the button so the panel clamp measures it,
     * and carries the shipped statistics row's type tier — a button does not
     * inherit it from the dock on its own.
     */
    const ANCHOR_STYLE = {
      position: 'relative',
      display: 'inline-flex',
      minWidth: 0,
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
    }

    /**
     * The rotating pill, matching the Session statistics pill it sits beside:
     * tertiary text tier, tabular figures, hover pill affordance.
     *
     * One box serves both entries, sized to the wider of the two — measured
     * from the hidden strip below, because the two entries' figures are not the
     * same length and a width guessed here would either clip one of them or
     * leave a hole before the next pill. `space-between` spends the narrower
     * entry's slack on its own gaps instead of leaving it outside the figures,
     * so both entries span the same box and the row never moves.
     */
    const PILL_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px',
      boxSizing: 'border-box',
      maxWidth: '100%',
      height: '22px',
      padding: '0 8px',
      border: 'none',
      borderRadius: '24px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-tertiary)',
      font: 'inherit',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 'inherit',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }

    /** The hovered or open pill's affordance, from the shared pill skin. */
    const PILL_ACTIVE_STYLE = {
      background: 'var(--dsw-alias-interactive-bg-hover)',
      color: 'var(--dsw-alias-label-secondary)',
    }

    /** The text half of a pill, clipped before it can push the row wider. */
    const LABEL_STYLE = {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }

    /** Between two readings in one pill, as the Session statistics pill draws it. */
    const SEPARATOR_STYLE = { color: 'var(--dsw-alias-separator-primary)' }

    /**
     * One entry laid out for measuring: every style the pill has, taken out of
     * flow so it cannot move the row, made invisible, and free of the pill's
     * percentage width cap — a cap resolved against a container this copy does
     * not fill would report zero however wide its figures are.
     */
    const MEASURED_STYLE = {
      ...PILL_STYLE,
      position: 'absolute',
      top: 0,
      left: 0,
      maxWidth: 'none',
      visibility: 'hidden',
      pointerEvents: 'none',
    }

    /** Portal surface: the shared stat-dialog skin, left and top from the placement clamp. */
    const PANEL_STYLE = {
      position: 'fixed',
      zIndex: 1100,
      boxSizing: 'border-box',
      width: 'max-content',
      minWidth: 'min(300px, calc(100vw - 24px))',
      maxWidth: 'min(440px, calc(100vw - 24px))',
      padding: '16px',
      border: 0,
      borderRadius: '12px',
      background: 'var(--dsw-specific-menu)',
      '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)',
      boxShadow: 'var(--dsw-elevation-prominent)',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'default',
    }

    /** Dialog heading row: the reading's name left, its headline value right. */
    const TITLE_STYLE = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      marginBottom: '8px',
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 500,
    }

    /** A later heading in the same dialog, spaced off the section above it. */
    const SECTION_TITLE_STYLE = { ...TITLE_STYLE, marginTop: '14px' }

    const TITLE_LABEL_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      minWidth: 0,
    }

    const TITLE_VALUE_STYLE = { fontVariantNumeric: 'tabular-nums' }

    /** Rule under the heading, above its rows. */
    const RULE_STYLE = {
      marginBottom: '10px',
      borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    }

    /** Two-column detail rows: label left, figure right, both tabular. */
    const DETAILS_STYLE = {
      display: 'grid',
      gridTemplateColumns: 'minmax(76px, auto) minmax(0, 1fr)',
      gap: '6px 16px',
      margin: 0,
      color: 'var(--dsw-alias-label-tertiary)',
    }

    const ROW_LABEL_STYLE = { minWidth: 0, margin: 0 }

    const ROW_VALUE_STYLE = {
      minWidth: 0,
      margin: 0,
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
    }

    /** A dialog with no figures to show states why instead of listing empty rows. */
    const NOTE_STYLE = { color: 'var(--dsw-alias-label-tertiary)' }

    /** Under one section's rows: why that reading has no figures, when it has none. */
    const SECTION_NOTE_STYLE = { marginTop: '6px', color: 'var(--dsw-alias-label-tertiary)' }

    /** Attributes shared by the three 14px glyphs. */
    const ICON_PROPS = {
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      style: { flex: 'none' },
    }

    /** A processor die: the package with its pins. */
    function CpuIcon() {
      return h('svg', ICON_PROPS,
        h('rect', { x: 4.75, y: 4.75, width: 6.5, height: 6.5, rx: 1.4 }),
        h('path', { d: 'M6.6 2.4v2.35M9.4 2.4v2.35M6.6 11.25v2.35M9.4 11.25v2.35M2.4 6.6h2.35M2.4 9.4h2.35M11.25 6.6h2.35M11.25 9.4h2.35' }))
    }

    /** One memory module: the body with its contact pins. */
    function MemoryIcon() {
      return h('svg', ICON_PROPS,
        h('rect', { x: 2.2, y: 4.6, width: 11.6, height: 6.4, rx: 1.4 }),
        h('path', { d: 'M5.2 11v2M8 11v2M10.8 11v2' }))
    }

    /** Interface traffic as one figure: the received bytes arrow down, sent arrow up. */
    function NetworkIcon() {
      return h('svg', ICON_PROPS,
        h('path', { d: 'M5 3.2v9.1M5 12.3 2.9 10.1M5 12.3l2.1-2.2M11 12.8V3.7M11 3.7 8.9 5.9M11 3.7l2.1 2.2' }))
    }

    /** Received traffic: the arrow pointing down into the machine. */
    function DownIcon() {
      return h('svg', ICON_PROPS, h('path', { d: 'M8 2.6v10.2M8 12.8 4.4 9.2M8 12.8l3.6-3.6' }))
    }

    /** Sent traffic: the arrow pointing up out of the machine. */
    function UpIcon() {
      return h('svg', ICON_PROPS, h('path', { d: 'M8 13.4V3.2M8 3.2 4.4 6.8M8 3.2l3.6 3.6' }))
    }

    /**
     * Format one byte count in the dictionary's units.
     * @param bytes - a byte count.
     * @param t - the bound dictionary.
     * @returns the formatted count, or null when the value is not a byte count.
     */
    function formatBytes(bytes, t) {
      if (!Number.isFinite(bytes) || bytes < 0) return null
      let value = bytes
      let unit = 0
      while (value >= UNIT_STEP && unit < BYTE_UNITS.length - 1) {
        value /= UNIT_STEP
        unit += 1
      }
      // Whole bytes stay whole; larger units carry a decimal until the number
      // is wide enough that one more digit would only make it harder to read.
      const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1)
      return t(BYTE_UNITS[unit], { value: text })
    }

    /**
     * Format one throughput in the dictionary's units.
     * @param bytesPerSecond - a byte-per-second rate.
     * @param t - the bound dictionary.
     * @returns the formatted rate with its per-second suffix, or null when the
     * rate is unavailable.
     */
    function formatRate(bytesPerSecond, t) {
      const bytes = formatBytes(bytesPerSecond, t)
      return bytes === null ? null : t('perSecond', { rate: bytes })
    }

    /**
     * Format one share as a whole percentage.
     * @param percent - a percentage.
     * @param t - the bound dictionary.
     * @returns the rounded percentage, or null when the share is unavailable.
     */
    function formatPercent(percent, t) {
      return Number.isFinite(percent) ? t('percent', { value: String(Math.round(percent)) }) : null
    }

    /**
     * Format the window one CPU reading was measured over.
     * @param ms - the window in milliseconds.
     * @param t - the bound dictionary.
     * @returns the formatted window, or the unavailable marker.
     */
    function formatWindow(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return t('unavailable')
      if (ms < 1000) return t('windowMilliseconds', { milliseconds: String(Math.round(ms)) })
      return t('windowSeconds', { seconds: (ms / 1000).toFixed(1) })
    }

    /**
     * Poll cadence one response asks for, floored so a page cannot outpace the
     * Host's sampler and defaulted when the Host reports nothing usable.
     * @param payload - the metrics response.
     * @returns the cadence in milliseconds.
     */
    function pollIntervalOf(payload) {
      const reported = Number(payload?.intervalMs)
      if (!Number.isFinite(reported) || reported <= 0) return DEFAULT_POLL_MS
      return Math.max(MIN_POLL_MS, reported)
    }

    /**
     * Build the two entries the pill alternates between, each as the segments
     * its label is made of and the dialog sections behind them.
     *
     * CPU and memory share one entry: both read as a short percentage, so one
     * box holds them side by side, while the network rates are long enough to
     * want the box on their own.
     *
     * @param reading - the metrics payload, or null when none is current.
     * @param failed - whether the route refused or failed.
     * @param t - the bound dictionary.
     * @returns the entries in rotation order.
     */
    function readingsOf(reading, failed, t) {
      const cpuPercent = formatPercent(reading?.cpu?.percent, t)
      const memoryPercent = formatPercent(reading?.memory?.percent, t)
      const used = formatBytes(reading?.memory?.usedBytes, t)
      const total = formatBytes(reading?.memory?.totalBytes, t)
      const available = Number.isFinite(reading?.memory?.totalBytes) && Number.isFinite(reading?.memory?.usedBytes)
        ? formatBytes(reading.memory.totalBytes - reading.memory.usedBytes, t)
        : null
      const down = formatRate(reading?.network?.receivedBytesPerSecond, t)
      const up = formatRate(reading?.network?.sentBytesPerSecond, t)
      const note = failed ? t('readFailedDetail') : null
      // The pill shows the figures alone — each carries the glyph that names it —
      // while the accessible name and the dialog state the reading in words.
      const cpuText = cpuPercent ?? t('unavailable')
      const memoryText = memoryPercent ?? t('unavailable')

      return {
        // The dialog is the same one for both entries: every reading the page
        // has, so a click never answers a narrower question than the pill asked.
        sections: [
          {
            icon: CpuIcon,
            title: t('cpuTitle'),
            value: cpuPercent ?? t('unavailable'),
            rows: [
              [t('rowUsage'), cpuPercent ?? t('unavailable')],
              [t('rowCores'), String(reading?.cpu?.cores ?? 0)],
              [t('rowWindow'), formatWindow(reading?.sampledOverMs, t)],
            ],
            note: null,
          },
          {
            icon: MemoryIcon,
            title: t('memoryTitle'),
            value: memoryPercent ?? t('unavailable'),
            rows: [
              [t('rowUsed'), used ?? t('unavailable')],
              [t('rowAvailable'), available ?? t('unavailable')],
              [t('rowTotal'), total ?? t('unavailable')],
              [t('rowUsage'), memoryPercent ?? t('unavailable')],
            ],
            note: null,
          },
          {
            icon: NetworkIcon,
            title: t('networkTitle'),
            value: down ?? t('unavailable'),
            rows: [
              [t('rowDown'), down ?? t('unavailable')],
              [t('rowUp'), up ?? t('unavailable')],
            ],
            note: down === null || up === null ? t('networkUnavailableDetail') : null,
          },
        ],
        note,
        entries: [
          {
            key: 'compute',
            // The pill shows the figures alone — each carries the glyph that
            // names it — while the accessible name states the reading in words.
            segments: [
              { icon: CpuIcon, text: cpuText, spoken: `${t('cpuTitle')} ${cpuText}` },
              { icon: MemoryIcon, text: memoryText, spoken: `${t('memoryTitle')} ${memoryText}` },
            ],
          },
          {
            key: 'network',
            // Each rate carries its own arrow, so the entry reads as two figures
            // beside the pair's two and stays within a few pixels of its width.
            segments: down === null || up === null
              ? [{ icon: NetworkIcon, text: t('unavailable'), spoken: `${t('networkTitle')} ${t('unavailable')}` }]
              : [
                { icon: DownIcon, text: down, spoken: `${t('rowDown')} ${down}` },
                { icon: UpIcon, text: up, spoken: `${t('rowUp')} ${up}` },
              ],
          },
        ],
      }
    }

    /**
     * The children one entry renders as: each figure's glyph and text, with the
     * separator the shipped pills draw between two figures in one pill.
     * @param entry - one entry from `readingsOf`.
     * @returns the entry's child elements.
     */
    function segmentsOf(entry) {
      return entry.segments.flatMap((segment, index) => [
        ...(index === 0 ? [] : [h('span', { key: `separator-${index}`, style: SEPARATOR_STYLE, 'aria-hidden': true }, '·')]),
        h(segment.icon, { key: `icon-${index}` }),
        h('span', { key: `text-${index}`, style: LABEL_STYLE }, segment.text),
      ])
    }

    /** The dock entry: one pill rotating through the Host machine's readings. */
    function SystemStats({ t }) {
      const [reading, setReading] = useState(null)
      const [failed, setFailed] = useState(false)
      const [at, setAt] = useState(0)
      const [open, setOpen] = useState(false)
      const [held, setHeld] = useState(false)
      const anchorRef = useRef(null)
      const panelRef = useRef(null)

      useEffect(() => {
        let cancelled = false
        let timer = null
        let pollMs = DEFAULT_POLL_MS

        const schedule = (ms) => {
          pollMs = ms
          timer = setTimeout(poll, ms)
        }

        const poll = async () => {
          if (document.hidden) {
            schedule(pollMs)
            return
          }
          try {
            const response = await fetch(API_PATH, { headers: { [GUARD_HEADER]: '1' }, cache: 'no-store' })
            if (!response.ok) throw new Error(`metrics route answered ${response.status}`)
            const payload = await response.json()
            if (cancelled) return
            setReading(payload)
            setFailed(false)
            schedule(pollIntervalOf(payload))
          } catch {
            // A refused or failed read has no current reading to show: the pill
            // falls back to unavailable instead of presenting the last numbers
            // as if the machine were still there.
            if (cancelled) return
            setReading(null)
            setFailed(true)
            schedule(DEFAULT_POLL_MS)
          }
        }

        const onVisibilityChange = () => {
          if (document.hidden) return
          clearTimeout(timer)
          poll()
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        poll()
        return () => {
          cancelled = true
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      }, [])

      // The rotation holds while the pointer or keyboard is on the pill, so a
      // reading cannot be swapped out from under someone reaching for it, and
      // holds while the dialog is open, so its figures stay the ones clicked.
      useEffect(() => {
        if (open || held) return undefined
        const timer = setInterval(() => {
          setAt(current => current + 1)
        }, ROTATE_MS)
        return () => { clearInterval(timer) }
      }, [open, held])

      const view = readingsOf(reading, failed, t)
      const current = view.entries[at % view.entries.length]

      // The heading doubles as the key of the copy the width was measured from,
      // which is what a language switch changes.
      const measureKey = t('memoryTitle')
      const [measured, setMeasured] = useState(null)
      useLayoutEffect(() => {
        const anchor = anchorRef.current
        if (anchor === null) return
        let widest = 0
        for (const node of anchor.children) {
          // The visible pill is the button; the copies beside it are the entries
          // being measured. `scrollWidth` covers a copy whose box still ends up
          // narrower than the figures inside it.
          if (node.tagName !== 'SPAN') continue
          const width = Math.max(node.getBoundingClientRect().width, node.scrollWidth)
          if (Number.isFinite(width) && width > widest) widest = width
        }
        // An unlaid-out document (jsdom in the tests) measures nothing, and the
        // pill then keeps its natural width instead of a zero-width box.
        if (widest <= 0) return
        setMeasured((previous) => {
          if (previous !== null && previous.key === measureKey && previous.width >= widest) return previous
          return { key: measureKey, width: Math.ceil(widest) }
        })
      })

      // Placement and outside-pointer dismissal are the same seats the Session
      // statistics pills use, so this dialog lands and closes like theirs.
      const pos = useAnchoredPosition({
        open,
        anchorRef,
        panelRef,
        side: 'top',
        gap: PANEL_GAP,
        margin: PANEL_MARGIN,
      })
      useDismissOnOutsidePointer(anchorRef, open, setOpen, panelRef)
      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => { document.removeEventListener('keydown', onKeyDown) }
      }, [open])

      // Every reading, in a fixed order, whichever entry the pill is showing.
      const sections = view.sections.map((section, index) => [
        h('div', { key: `title-${index}`, style: index === 0 ? TITLE_STYLE : SECTION_TITLE_STYLE },
          h('span', { style: TITLE_LABEL_STYLE }, h(section.icon), section.title),
          h('span', { style: TITLE_VALUE_STYLE }, section.value)),
        h('div', { key: `rule-${index}`, style: RULE_STYLE, 'aria-hidden': true }),
        h('dl', { key: `rows-${index}`, style: DETAILS_STYLE }, section.rows.flatMap(([label, value], row) => [
          h('dt', { key: `label-${index}-${row}`, style: ROW_LABEL_STYLE }, label),
          h('dd', { key: `value-${index}-${row}`, style: ROW_VALUE_STYLE }, value),
        ])),
        section.note === null
          ? null
          : h('div', { key: `note-${index}`, style: SECTION_NOTE_STYLE }, section.note),
      ])

      // One box for both entries: the wider entry's measured width is the pill's
      // minimum, so the narrower one spans the same box instead of sitting in a
      // narrower reading that the row's centring then shifts.
      const pillStyle = measured === null || measured.key !== measureKey
        ? PILL_STYLE
        : { ...PILL_STYLE, minWidth: `${measured.width}px` }

      return h('span', { ref: anchorRef, style: ANCHOR_STYLE },
        h('button', {
          type: 'button',
          style: held || open ? { ...pillStyle, ...PILL_ACTIVE_STYLE } : pillStyle,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': current.segments.map(segment => segment.spoken ?? segment.text).join(' · '),
          onMouseEnter: () => { setHeld(true) },
          onMouseLeave: () => { setHeld(false) },
          onFocus: () => { setHeld(true) },
          onBlur: () => { setHeld(false) },
          onClick: () => { setOpen(!open) },
        },
        segmentsOf(current)),
        view.entries.map((entry, index) => h('span', {
          key: `measured-${index}`,
          style: MEASURED_STYLE,
          'aria-hidden': true,
        }, segmentsOf(entry))),
        open && createPortal(
          h('div', {
            ref: panelRef,
            style: pos === null ? { ...PANEL_STYLE, ...MEASURE_STYLE } : { ...PANEL_STYLE, ...pos },
            role: 'dialog',
            'aria-label': t('dialogLabel'),
          },
          view.note === null ? sections : h('div', { style: NOTE_STYLE }, view.note)),
          document.body))
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries and the dock entry.
       * @param ctx - the Client plugin context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-system-stats: dictionaries')
        // Negative order keeps this pill left of the Session statistics entry,
        // which the chat plugin registers at order 0 in the same dock.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'system-stats', order: -1, locale: NS,
        }, SystemStats))
      },
    }
  },
})
