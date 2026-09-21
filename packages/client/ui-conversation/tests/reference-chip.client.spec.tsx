// @vitest-environment jsdom
/**
 * ReferenceChip visual face: icon selection per appearance, the trigger
 * marker fallback, the source a chip is drawn by, label truncation container,
 * and invalid styling.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReferenceChip } from '../src/client/input/editor/ReferenceChip.tsx'

afterEach(cleanup)

describe('ReferenceChip', () => {
  it('renders the domain icon and the label', () => {
    const { container, getByTitle } = render(
      <ReferenceChip label="Research notes" source="reference" appearance="session" invalid={false} />,
    )
    expect(getByTitle('Research notes')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Research notes')
  })

  it('falls back to the trigger marker without an appearance', () => {
    const { container } = render(<ReferenceChip label="commit-helper" source="skill" invalid={false} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('@commit-helper')
  })

  it('carries the owning source, which is what the styles draw a kind by', () => {
    const { container } = render(<ReferenceChip label="mogo_9" source="mcp" invalid={false} />)
    const chip = container.firstElementChild
    expect(chip?.getAttribute('data-source')).toBe('mcp')
    // The two plugin kinds hide the marker: their trigger is the slash the
    // clipboard projection already carries.
    expect(container.textContent).toBe('mogo_9')
  })

  it('applies the invalid styling bit', () => {
    const { container } = render(
      <ReferenceChip label="gone" source="reference" appearance="folder" invalid />,
    )
    const chip = container.firstElementChild
    expect(chip).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('invalid'))).toBe(true)
  })
})
