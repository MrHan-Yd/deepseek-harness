/**
 * dsh-usage-stats browser half: the Settings page for installation-wide usage.
 *
 * Shipped as a Dynamic Client bundle without a build step: the factory takes
 * `react` from the platform module table and builds every element with
 * `createElement`, so the file in `src/` is the file a reviewer reads. The
 * charts are hand-built SVG for the same reason: the bundle resolves nothing
 * but `react`.
 *
 * The page reads one payload from `/usage-stats/api/summary` and derives every
 * figure from it. Day buckets, model shares, streaks, and the peak day are all
 * presentation over that payload, so the Host stays the only place that reads
 * Session logs.
 *
 * @module dsh-usage-stats/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-stats',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.usageStats'

    const zh = {
      nav: '使用统计',
      tabApp: '应用用量',
      statTotal: '累计 Token 数',
      statPeak: '峰值 Token 数',
      statLongest: '最长聊天时长',
      statStreak: '当前连续天数',
      statLongestStreak: '最长连续天数',
      activity: 'Token 活动',
      modeDaily: '每日',
      modeWeekly: '每周',
      modeCumulative: '累计',
      range: '时间范围',
      range7: '近 7 日',
      range30: '近 30 日',
      trend: '每日 Token 趋势图',
      models: '模型用量',
      unitTurns: '轮消息',
      unitTokens: 'tokens',
      unitHour: '小时',
      unitMinute: '分钟',
      unitSecond: '秒',
      unitDay: '天',
      loading: '正在统计会话数据…',
      refresh: '刷新',
      refreshing: '刷新中…',
      retry: '重试',
      empty: '还没有可统计的会话数据。',
      emptyTrend: '所选时间范围内没有 Token 消耗。',
      partial: '有个别会话无法读取，已跳过。',
      others: '其他',
    }

    const en = {
      nav: 'Usage statistics',
      tabApp: 'App usage',
      statTotal: 'Total tokens',
      statPeak: 'Peak tokens',
      statLongest: 'Longest chat',
      statStreak: 'Current streak',
      statLongestStreak: 'Longest streak',
      activity: 'Token activity',
      modeDaily: 'Daily',
      modeWeekly: 'Weekly',
      modeCumulative: 'Cumulative',
      range: 'Time range',
      range7: 'Last 7 days',
      range30: 'Last 30 days',
      trend: 'Daily token trend',
      models: 'Model usage',
      unitTurns: 'rounds',
      unitTokens: 'tokens',
      unitHour: 'h',
      unitMinute: 'm',
      unitSecond: 's',
      unitDay: 'd',
      loading: 'Collecting session statistics…',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      retry: 'Retry',
      empty: 'No session data to summarise yet.',
      emptyTrend: 'No token spend in the selected range.',
      partial: 'Some sessions could not be read and were skipped.',
      others: 'Other',
    }

    /**
     * Model series palette. Index into it by a model's rank in the current
     * payload, so a legend colour stays stable while the data holds still and
     * the largest spender always leads with the same hue.
     */
    const PALETTE = ['#4f8cff', '#3fca7f', '#a06bff', '#ff8a4c', '#ff5f7a', '#2fc4d4', '#d4b02f', '#8a93a6']

    /** Most series drawn; everything past this rank folds into one "other" line. */
    const MAX_SERIES = 6

    /** Heatmap geometry in CSS pixels. */
    const CELL = 12
    const CELL_GAP = 3

    /** Heatmap columns: 53 weeks covers a year with the current week last. */
    const WEEKS = 53

    /**
     * The five-step heat ramp, empty first. The accent is a fixed rgba rather
     * than a theme alias because SVG `fill` must resolve identically in both
     * colour schemes, and the empty step stays neutral grey on either.
     */
    const HEAT = ['rgba(127,127,127,0.16)', 'rgba(79,140,255,0.25)', 'rgba(79,140,255,0.45)', 'rgba(79,140,255,0.68)', '#4f8cff']

    const border = '1px solid color-mix(in srgb, currentColor 14%, transparent)'
    const softBorder = '1px solid color-mix(in srgb, currentColor 9%, transparent)'
    const subtle = 'color-mix(in srgb, currentColor 5%, transparent)'
    const chipStyle = {
      fontSize: 11, padding: '2px 8px', borderRadius: 6, border: softBorder,
      opacity: 0.75, whiteSpace: 'nowrap',
    }
    const buttonStyle = {
      padding: '7px 14px', borderRadius: 8, border, background: subtle,
      color: 'inherit', font: 'inherit', cursor: 'pointer',
    }
    const cardStyle = { border, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }

    /** @param ms - local epoch milliseconds. @returns the `YYYY-MM-DD` day key. */
    function dayKey(ms) {
      const date = new Date(ms)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    /** @param date - a local date. @returns a copy moved by whole days. */
    function shiftDays(date, days) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      next.setDate(next.getDate() + days)
      return next
    }

    /** @param date - a local date. @returns the Sunday that starts its week. */
    function startOfWeek(date) {
      return shiftDays(date, -date.getDay())
    }

    /**
     * Compact token counts the way each language writes large numbers.
     * @param locale - the BCP 47-style active locale id.
     * @param value - the count.
     * @returns the localized compact form, for example `3.6亿` or `360M`.
     */
    function compact(locale, value) {
      return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    }

    /**
     * A chat duration as whole hours and minutes.
     * @param t - the bound translator.
     * @param ms - the duration in milliseconds.
     * @returns the localized duration, for example `8小时27分钟`.
     */
    function duration(t, ms) {
      const minutes = Math.floor(ms / 60000)
      const hours = Math.floor(minutes / 60)
      if (hours > 0) return `${hours}${t('unitHour')}${minutes % 60}${t('unitMinute')}`
      if (minutes > 0) return `${minutes}${t('unitMinute')}`
      return `${Math.floor(ms / 1000)}${t('unitSecond')}`
    }

    /**
     * Consecutive active days ending today, or ending yesterday when today is
     * still quiet — a streak is not broken until a whole day passes without one.
     * @param active - set of active day keys.
     * @param today - today's day key.
     * @returns the streak length in days.
     */
    function currentStreak(active, today) {
      let cursor = new Date(`${today}T00:00:00`)
      if (!active.has(today)) cursor = shiftDays(cursor, -1)
      let length = 0
      while (active.has(dayKey(cursor.getTime()))) {
        length += 1
        cursor = shiftDays(cursor, -1)
      }
      return length
    }

    /**
     * Longest run of consecutive active days.
     * @param active - active day keys.
     * @returns the run length in days.
     */
    function longestStreak(active) {
      let best = 0
      let run = 0
      let previous = null
      for (const key of [...active].sort()) {
        // Adjacency is a calendar step, not a fixed 86,400,000 ms: across a
        // daylight-saving transition two local midnights are 23 or 25 hours
        // apart, and a millisecond delta would break a live streak there.
        const adjacent = previous !== null && dayKey(shiftDays(new Date(`${previous}T00:00:00`), 1).getTime()) === key
        run = adjacent ? run + 1 : 1
        previous = key
        if (run > best) best = run
      }
      return best
    }

    /**
     * Rank models by total spend and fold the tail into one remainder series.
     * @param models - the payload's model rows.
     * @param t - the bound translator.
     * @returns series with a stable colour index each.
     */
    function seriesOf(models, t) {
      const ranked = [...models].sort((left, right) => totalOfRow(right) - totalOfRow(left))
      if (ranked.length <= MAX_SERIES) {
        return ranked.map((row, at) => ({ key: row.model, label: row.model, color: PALETTE[at % PALETTE.length], tokens: totalOfRow(row) }))
      }
      const head = ranked.slice(0, MAX_SERIES - 1)
      const tail = ranked.slice(MAX_SERIES - 1)
      return [
        ...head.map((row, at) => ({ key: row.model, label: row.model, color: PALETTE[at % PALETTE.length], tokens: totalOfRow(row) })),
        {
          key: '\u0000other',
          label: t('others'),
          color: PALETTE[(MAX_SERIES - 1) % PALETTE.length],
          tokens: tail.reduce((sum, row) => sum + totalOfRow(row), 0),
          members: tail.map(row => row.model),
        },
      ]
    }

    /** @param row - one model row. @returns its four-bucket total. */
    function totalOfRow(row) {
      return row.input + row.output + row.cacheRead + row.cacheWrite
    }

    /**
     * One labelled card holding a single figure.
     * @param props - the caption and the formatted value.
     * @returns the card element.
     */
    function StatCard(props) {
      return h('div', { style: { flex: '1 1 140px', minWidth: 0, padding: '2px 4px' } },
        h('div', { style: { fontSize: 19, fontWeight: 600, lineHeight: 1.3 } }, props.value),
        h('div', { style: { fontSize: 12, opacity: 0.6, marginTop: 6 } }, props.label))
    }

    /**
     * One segmented control.
     * @param props - the options, the selected value, and the change handler.
     * @returns the control element.
     */
    function Segmented(props) {
      return h('div', { style: { display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: subtle } },
        props.options.map(option => h('button', {
          key: option.value,
          type: 'button',
          onClick: () => props.onChange(option.value),
          style: {
            padding: '4px 12px', borderRadius: 6, border: 'none', font: 'inherit', fontSize: 12, cursor: 'pointer',
            background: option.value === props.value ? 'color-mix(in srgb, currentColor 14%, transparent)' : 'transparent',
            color: 'inherit',
            opacity: option.value === props.value ? 1 : 0.65,
          },
        }, option.label)))
    }

    /**
     * The card a chart shows while the pointer is on one of its marks.
     *
     * It is positioned from the mark's own place in the chart rather than from
     * the pointer, so it holds still while the pointer moves inside one band,
     * and it never takes pointer events: the mark underneath keeps them.
     *
     * @param props - the tip, or null while no mark is hovered. A tip is
     *   `{ x, align, top, dot, title, lines, rows }`: `title` may carry a
     *   leading colour dot, `lines` are plain sentences, and `rows` are the
     *   labelled grid a breakdown uses.
     * @returns the card element, or null.
     */
    function HoverCard(props) {
      const { tip } = props
      if (tip === null || tip === undefined) return null
      const rows = tip.rows ?? []
      const lines = tip.lines ?? []
      return h('div', {
        style: {
          position: 'absolute', left: `${tip.x}%`, top: tip.top ?? 0,
          transform: `translate(${tip.align ?? '-50%'}, 0)`,
          zIndex: 6, pointerEvents: 'none', maxWidth: 280, padding: '8px 10px',
          borderRadius: 8, border, background: 'var(--dsw-alias-bg-overlay)',
          boxShadow: '0 8px 24px rgba(0,0,0,.28)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'nowrap',
        },
      },
      tip.title === undefined || tip.title === ''
        ? null
        : h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: rows.length === 0 && lines.length === 0 ? 0 : 6,
            fontWeight: tip.dot === undefined ? undefined : 600,
          },
        },
        tip.dot === undefined
          ? null
          : h('span', { style: { width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: tip.dot } }),
        h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, tip.title)),
      lines.map((line, at) => h('div', { key: `line-${at}` }, line)),
      rows.length === 0
        ? null
        : h('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '3px 8px',
          },
        }, rows.flatMap(row => [
          h('span', {
            key: `${row.label}-dot`,
            style: {
              width: 8, height: 8, borderRadius: 4, flexShrink: 0,
              background: row.color ?? 'currentColor',
              opacity: row.color === undefined ? 0.4 : 1,
              visibility: row.color === undefined ? 'hidden' : 'visible',
            },
          }),
          h('span', { key: `${row.label}-name`, style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, row.label),
          h('span', {
            key: `${row.label}-value`,
            style: { opacity: 0.85, fontVariantNumeric: 'tabular-nums' },
          }, row.value),
        ])))
    }

    /**
     * Where one band's card sits, kept inside the chart at both ends.
     * @param index - the band index.
     * @param count - how many bands the chart has.
     * @returns the `x` percent and the transform that keeps the card inside.
     */
    function tipAnchor(index, count) {
      const x = count <= 1 ? 50 : (index / (count - 1)) * 100
      if (index === 0 && count > 1) return { x, align: '0' }
      if (index === count - 1 && count > 1) return { x, align: '-100%' }
      return { x, align: '-50%' }
    }

    /**
     * The year-long token activity heatmap.
     * @param props - day buckets, the selected mode, and the bound translator.
     * @returns the heatmap element.
     */
    function Heatmap(props) {
      const { days, mode, t, locale } = props
      const [hovered, setHovered] = useState(null)
      const today = shiftDays(new Date(), 0)
      const todayKey = dayKey(today.getTime())
      const first = startOfWeek(shiftDays(today, -7 * (WEEKS - 1)))

      const grid = useMemo(() => {
        // Running totals per active day, so a cumulative cell reads the spend up
        // to its own day rather than the grand total.
        const spends = Object.keys(days).sort().map(key => [key, days[key].tokens])
        let cursor = 0
        let running = 0
        const cumulativeOf = (key) => {
          while (cursor < spends.length && spends[cursor][0] <= key) {
            running += spends[cursor][1]
            cursor += 1
          }
          return running
        }
        const built = []
        let peakCumulative = 0
        for (let week = 0; week < WEEKS; week += 1) {
          const cells = []
          let weekTokens = 0
          for (let weekday = 0; weekday < 7; weekday += 1) {
            const date = shiftDays(first, week * 7 + weekday)
            const key = dayKey(date.getTime())
            const row = days[key]
            weekTokens += row?.tokens ?? 0
            const cumulative = cumulativeOf(key)
            if (cumulative > peakCumulative) peakCumulative = cumulative
            cells.push({ key, future: key > todayKey, cumulative, daily: row?.tokens ?? 0, turns: row?.turns ?? 0 })
          }
          built.push({ cells, weekTokens, month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(shiftDays(first, week * 7)) })
        }
        return {
          columns: built,
          peakDaily: Math.max(1, ...built.flatMap(column => column.cells.map(cell => cell.daily))),
          peakWeekly: Math.max(1, ...built.map(column => column.weekTokens)),
          peakCumulative: Math.max(1, peakCumulative),
        }
      }, [days, first.getTime(), locale, todayKey])

      const columns = grid.columns
      const peak = mode === 'weekly' ? grid.peakWeekly : mode === 'cumulative' ? grid.peakCumulative : grid.peakDaily

      /**
       * Map one value onto the five-step intensity scale.
       * @param value - the cell's value in the active mode.
       * @returns the step, 0 for an empty cell.
       */
      const levelOf = (value) => (value <= 0 ? 0 : 1 + Math.min(3, Math.floor((value / peak) * 4)))
      const fillOf = (level) => HEAT[level]

      // Drawn as one scaled SVG: 53 fixed-width columns cannot fit the Settings
      // panel at every window size, and a scaled viewBox shrinks the whole year
      // into whatever width the panel has instead of clipping its tail.
      const pitch = CELL + CELL_GAP
      const labelHeight = 14
      const modeLabel = mode === 'weekly' ? t('modeWeekly') : t('modeCumulative')
      const tip = hovered === null ? null : {
        ...tipAnchor(hovered.at, columns.length),
        top: 0,
        title: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' })
          .format(new Date(`${hovered.key}T00:00:00`)),
        // The day's own numbers, the way the reference reads: the spend, then
        // what it took to make it. Off the daily scale the mode's total follows.
        lines: [
          [
            `${compact(locale, hovered.daily)} ${t('unitTokens')}`,
            `${hovered.turns} ${t('unitTurns')}`,
            ...(mode === 'daily' ? [] : [`${modeLabel} ${compact(locale, hovered.value)}`]),
          ].join(' · '),
        ],
      }
      return h('div', { style: { position: 'relative' } },
        h('svg', {
          viewBox: `0 0 ${WEEKS * pitch} ${labelHeight + 7 * pitch}`,
          width: '100%',
          role: 'img',
          'aria-label': t('activity'),
          onMouseLeave: () => { setHovered(null) },
        },
        columns.map((column, at) => h('g', { key: at },
          at === 0 || column.month !== columns[at - 1].month
            ? h('text', {
              x: at * pitch, y: 10, fontSize: 9,
              fill: 'currentColor', fillOpacity: 0.55,
            }, column.month)
            : null,
          column.cells.map((cell, row) => {
            const value = mode === 'weekly' ? column.weekTokens : mode === 'cumulative' ? cell.cumulative : cell.daily
            // A cell is lit only for a day that actually spent tokens. The mode
            // picks the SCALE — this day, this week, or the running total — but
            // never paints a day that was not used, which is what made a week
            // look active on all seven of its days.
            const level = cell.daily > 0 ? levelOf(value) : 0
            return h('rect', {
              key: cell.key,
              x: at * pitch, y: labelHeight + row * pitch, width: CELL, height: CELL, rx: 2.5,
              fill: cell.future ? 'transparent' : fillOf(level),
              stroke: cell.key === todayKey ? PALETTE[0] : 'none',
              strokeWidth: cell.key === todayKey ? 1 : 0,
              // The whole year is one SVG, so a cell reads itself out through
              // this card: a native `<title>` here arrives late, unstyled, and
              // only for the pointer resting on the cell.
              onMouseOver: () => { setHovered({ at, key: cell.key, daily: cell.daily, turns: cell.turns, value }) },
            })
          })))),
        h(HoverCard, { tip }))
    }

    /**
     * The daily token trend, one line per model series.
     * @param props - day buckets, ranked series, the range length, and the translator.
     * @returns the chart element.
     */
    function TrendChart(props) {
      const { days, series, range, t, locale } = props
      const [hovered, setHovered] = useState(null)
      const width = 760
      const height = 220
      const pad = { left: 58, right: 14, top: 12, bottom: 28 }
      const plotWidth = width - pad.left - pad.right
      const plotHeight = height - pad.top - pad.bottom

      const dates = useMemo(() => {
        const today = shiftDays(new Date(), 0)
        return Array.from({ length: range }, (_, at) => shiftDays(today, at - (range - 1)))
      }, [range])

      const values = series.map(entry => dates.map(date => {
        const row = days[dayKey(date.getTime())]
        if (row === undefined) return 0
        return entry.members === undefined
          ? (row.models[entry.key] ?? 0)
          : entry.members.reduce((sum, model) => sum + (row.models[model] ?? 0), 0)
      }))
      const peak = Math.max(1, ...values.flat())
      const xOf = (at) => pad.left + (dates.length === 1 ? plotWidth / 2 : (at / (dates.length - 1)) * plotWidth)
      const yOf = (value) => pad.top + plotHeight - (value / peak) * plotHeight
      const ticks = Array.from({ length: 4 }, (_, at) => (peak / 3) * at)

      const empty = values.every(row => row.every(value => value === 0))
      // One invisible band per date carries the hover: it is the mark the person
      // is pointing at, so the card can hold still inside a band instead of
      // chasing the pointer, and the readout needs no geometry from the DOM.
      const band = dates.length <= 1 ? plotWidth : plotWidth / (dates.length - 1)
      const dayTotal = (at) => series.reduce((sum, _, index) => sum + values[index][at], 0)
      const tip = hovered === null || dates[hovered] === undefined ? null : {
        ...tipAnchor(hovered, dates.length),
        top: 0,
        title: `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(dates[hovered])} - ${compact(locale, dayTotal(hovered))} ${t('unitTokens')}`,
        rows: series
          .map((entry, index) => ({ color: entry.color, label: entry.label, tokens: values[index][hovered] }))
          .filter(row => row.tokens > 0)
          .sort((left, right) => right.tokens - left.tokens)
          .map(row => ({ color: row.color, label: row.label, value: `${compact(locale, row.tokens)} ${t('unitTokens')}` })),
      }
      return h('div', null,
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 } },
          series.map(entry => h('span', { key: entry.key, style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.8 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 4, background: entry.color, flexShrink: 0 } }),
            entry.label))),
        empty
          ? h('div', { style: { fontSize: 12, opacity: 0.55, padding: '40px 0', textAlign: 'center' } }, t('emptyTrend'))
          : h('div', { style: { position: 'relative' } },
            h('svg', {
              viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': t('trend'),
              onMouseLeave: () => { setHovered(null) },
            },
            ticks.map((tick, at) => h('g', { key: at },
              h('line', {
                x1: pad.left, x2: width - pad.right, y1: yOf(tick), y2: yOf(tick),
                stroke: 'currentColor', strokeOpacity: 0.12, strokeDasharray: '3 4',
              }),
              h('text', { x: pad.left - 8, y: yOf(tick) + 4, textAnchor: 'end', fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 },
                compact(locale, Math.round(tick))))),
            dates.map((date, at) => {
              const step = dates.length > 10 ? 5 : 1
              if (at % step !== 0 && at !== dates.length - 1) return null
              return h('text', {
                key: at, x: xOf(at), y: height - 8, textAnchor: 'middle', fontSize: 10,
                fill: 'currentColor', fillOpacity: 0.55,
              }, new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date))
            }),
            hovered === null
              ? null
              : h('line', {
                x1: xOf(hovered), x2: xOf(hovered), y1: pad.top, y2: pad.top + plotHeight,
                stroke: 'currentColor', strokeOpacity: 0.35, strokeDasharray: '3 3',
              }),
            values.map((row, at) => h('polyline', {
              key: series[at].key,
              points: row.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' '),
              fill: 'none', stroke: series[at].color, strokeWidth: 2,
              strokeLinejoin: 'round', strokeLinecap: 'round',
            })),
            dates.map((_, at) => h('rect', {
              key: `band-${at}`,
              x: Math.max(0, xOf(at) - band / 2), y: pad.top,
              width: band, height: plotHeight, fill: 'transparent',
              onMouseOver: () => { setHovered(at) },
            }))),
            h(HoverCard, { tip })))
    }

    /**
     * The model-share donut with its legend.
     * @param props - ranked series, the grand total, and the translator.
     * @returns the donut element.
     */
    function Donut(props) {
      const { series, total, t, locale } = props
      const [hovered, setHovered] = useState(null)
      const size = 220
      const radius = 74
      const stroke = 26
      const circumference = 2 * Math.PI * radius
      let offset = 0

      const share = (tokens) => (total === 0 ? 0 : tokens / total)
      const percent = (tokens) => `${total === 0 ? '0' : (share(tokens) * 100).toFixed(share(tokens) < 0.1 ? 1 : 0)}%`
      const entry = hovered === null ? undefined : series.find(row => row.key === hovered)
      // The card sits in the ring's own box, over the slice being read: the
      // legend beside it already lists every model, so the hover answers "how
      // much of the whole is this slice" rather than repeating the list.
      const tip = entry === undefined ? null : {
        x: 50,
        align: '-50%',
        top: 8,
        dot: entry.color,
        title: entry.label,
        // The reference's two lines: what this slice spent, and how much of the
        // whole that is.
        rows: [{ label: `${compact(locale, entry.tokens)} ${t('unitTokens')}`, value: percent(entry.tokens) }],
      }

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' } },
        h('div', {
          style: { position: 'relative', width: size, height: size, flexShrink: 0 },
          onMouseLeave: () => { setHovered(null) },
        },
          h('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': t('models') },
            h('circle', {
              cx: size / 2, cy: size / 2, r: radius, fill: 'none',
              stroke: 'color-mix(in srgb, currentColor 8%, transparent)', strokeWidth: stroke,
            }),
            series.map((row) => {
              const fraction = total === 0 ? 0 : row.tokens / total
              const dash = fraction * circumference
              const element = h('circle', {
                key: row.key,
                cx: size / 2, cy: size / 2, r: radius, fill: 'none',
                stroke: row.color, strokeWidth: stroke,
                strokeDasharray: `${dash} ${circumference - dash}`,
                strokeDashoffset: -offset,
                transform: `rotate(-90 ${size / 2} ${size / 2})`,
                // A slice with no width has no stroke to point at, which is
                // right: an empty model holds no share to read out.
                onMouseOver: dash === 0 ? undefined : () => { setHovered(row.key) },
              })
              offset += dash
              return element
            })),
          h('div', {
            style: {
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 2, pointerEvents: 'none',
            },
          },
            h('div', { style: { fontSize: 18, fontWeight: 600 } }, compact(locale, total)),
            h('div', { style: { fontSize: 11, opacity: 0.55 } }, t('unitTokens'))),
          h(HoverCard, { tip })),
        h('div', { style: { flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 } },
          series.map(row => h('div', {
            key: row.key,
            style: { minWidth: 0, opacity: hovered === null || hovered === row.key ? 1 : 0.55 },
            onMouseOver: () => { setHovered(row.key) },
            onMouseLeave: () => { setHovered(null) },
          },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 4, background: row.color, flexShrink: 0 } }),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.label),
            h('span', { style: { opacity: 0.85 } }, percent(row.tokens))),
          h('div', { style: { fontSize: 12, opacity: 0.55, marginTop: 3, marginLeft: 16 } },
            `${compact(locale, row.tokens)} ${t('unitTokens')}`)))))
    }

    /**
     * The Settings page for installation-wide usage.
     * @param props - the bound translator, the payload loader, and the compact formatter.
     * @returns the section element.
     */
    function UsageSection(props) {
      const { t, load, locale: activeLocale } = props
      // The active locale is read per render rather than captured at
      // registration, so a language switch reformats numbers without a reload.
      const locale = activeLocale()
      const [state, setState] = useState(undefined)
      const [failure, setFailure] = useState('')
      const [busy, setBusy] = useState(false)
      const [mode, setMode] = useState('daily')
      const [range, setRange] = useState(7)

      const refresh = useCallback(async (force) => {
        setBusy(true)
        try {
          setState(await load(force === true))
          setFailure('')
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }, [load])

      useEffect(() => { void refresh(false) }, [refresh])

      const view = useMemo(() => {
        if (state === undefined || state?.ok !== true) return undefined
        const days = state.days ?? {}
        const active = new Set(Object.keys(days).filter(key => days[key].tokens > 0))
        const models = (state.models ?? []).filter(row => totalOfRow(row) > 0)
        const peakDay = Object.values(days).reduce((best, row) => Math.max(best, row.tokens), 0)
        const longestChat = (state.sessions ?? []).reduce((best, row) => Math.max(best, row.lastAt - row.createdAt), 0)
        return {
          days,
          series: seriesOf(models, t),
          total: state.totals?.tokens ?? 0,
          peakDay,
          longestChat,
          streak: currentStreak(active, dayKey(Date.now())),
          longestStreak: longestStreak(active),
          skipped: state.totals?.skipped ?? 0,
        }
      }, [state, t])

      const header = h('div', { style: { marginBottom: 18 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { fontSize: 20, fontWeight: 600 } }, t('nav')),
          h('span', { style: chipStyle }, t('tabApp'))))

      if (failure !== '') {
        return h('div', { style: { maxWidth: 880 } }, header,
          h('div', { style: { ...cardStyle, fontSize: 13, opacity: 0.8 } },
            h('div', null, failure),
            h('button', { type: 'button', style: { ...buttonStyle, marginTop: 12 }, onClick: () => { void refresh(true) } }, t('retry'))))
      }
      if (view === undefined) {
        return h('div', { style: { maxWidth: 880 } }, header,
          h('div', { style: { fontSize: 13, opacity: 0.6, padding: '24px 0' } }, t('loading')))
      }

      const stats = [
        { label: t('statTotal'), value: compact(locale, view.total) },
        { label: t('statPeak'), value: compact(locale, view.peakDay) },
        { label: t('statLongest'), value: duration(t, view.longestChat) },
        { label: t('statStreak'), value: `${view.streak}${t('unitDay')}` },
        { label: t('statLongestStreak'), value: `${view.longestStreak}${t('unitDay')}` },
      ]

      return h('div', { style: { maxWidth: 880 } },
        header,
        h('div', { style: { ...cardStyle, display: 'flex', flexWrap: 'wrap', rowGap: 12 } },
          stats.map(stat => h(StatCard, { key: stat.label, label: stat.label, value: stat.value }))),
        h('div', { style: cardStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 } },
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('activity')),
            h(Segmented, {
              value: mode,
              onChange: setMode,
              options: [
                { value: 'daily', label: t('modeDaily') },
                { value: 'weekly', label: t('modeWeekly') },
                { value: 'cumulative', label: t('modeCumulative') },
              ],
            })),
          view.total === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.55, padding: '32px 0', textAlign: 'center' } }, t('empty'))
            : h(Heatmap, { days: view.days, mode, t, locale })),
        h('div', { style: cardStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 } },
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('range')),
            h(Segmented, {
              value: range,
              onChange: setRange,
              options: [{ value: 7, label: t('range7') }, { value: 30, label: t('range30') }],
            })),
          h(TrendChart, { days: view.days, series: view.series, range, t, locale })),
        h('div', { style: cardStyle },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 16 } }, t('models')),
          h(Donut, { series: view.series, total: view.total, t, locale })),
        view.skipped > 0 ? h('div', { style: { fontSize: 11, opacity: 0.55, marginBottom: 10 } }, t('partial')) : null,
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', {
            type: 'button', style: { ...buttonStyle, opacity: busy ? 0.6 : 1 }, disabled: busy,
            onClick: () => { void refresh(true) },
          }, busy ? t('refreshing') : t('refresh'))))
    }

    /**
     * Call one Host route.
     * @param path - the route path after the plugin prefix.
     * @returns the decoded response body.
     */
    async function request(path) {
      const response = await fetch(`/usage-stats/api${path}`, { headers: { 'x-dsh-usage-stats': '1' } })
      const decoded = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (decoded?.ok !== true) throw new Error(decoded?.error ?? `HTTP ${response.status}`)
      return decoded
    }

    /** Services the page reads. */
    const inject = ['slots', 'locale']

    /**
     * Register the Settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-usage-stats: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'usage-stats',
        order: 20,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({
          load: force => request(`/summary${force ? '?refresh=1' : ''}`),
          locale: () => ctx.locale.getSnapshot().active,
        }),
      }, UsageSection))
    }

    exports.name = 'dsh-usage-stats'
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
