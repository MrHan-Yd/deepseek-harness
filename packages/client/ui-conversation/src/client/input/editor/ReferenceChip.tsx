/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReferenceChip.module.css'
import referenceCss from './composer-editor.module.css'

/**
 * Sources whose chip is the bare name: an MCP server and a subagent are named
 * by a `/name` token whose trigger the clipboard projection carries, so the
 * fallback `@` marker would name the wrong gesture. Every other source keeps it.
 */
const MARKERLESS_SOURCES: ReadonlySet<string> = new Set(['mcp', 'subagent'])

/** Per-source chip colors; an unknown source keeps the shared reference color. */
const SOURCE_CLASS: Readonly<Record<string, string | undefined>> = {
  mcp: css.sourceMcp,
  subagent: css.sourceSubagent,
}

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  /**
   * Name of the source that owns this reference. Presentation only: the styles
   * key on it, so a kind a person must tell apart at a glance is drawn apart.
   */
  readonly source: string
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
}

/**
 * Render one inline reference chip.
 * @param props - label, owning source, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label).
 */
export function ReferenceChip({ label, source, appearance, invalid }: ReferenceChipProps): ReactNode {
  return (
    <span
      className={clsx(
        referenceCss.reference,
        css.chip,
        SOURCE_CLASS[source],
        appearance === 'file' && !invalid && referenceCss.openable,
        invalid && css.invalid,
      )}
      data-source={source}
      title={label}
    >
      {appearance !== undefined
        ? <ReferenceIcon kind={appearance} size={14} className={css.icon} />
        : MARKERLESS_SOURCES.has(source)
          ? null
          : <span className={css.marker} aria-hidden>@</span>}
      <span className={css.label}>{label}</span>
    </span>
  )
}
