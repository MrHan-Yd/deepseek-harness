/**
 * Editable reference tokens share chip hover styling and ordinary text
 * semantics for editing, and one Backspace/Delete takes a whole token out
 * rather than one character of it.
 */
import clsx from 'clsx'
import type { EditorConfig, LexicalEditor, LexicalNode, SerializedTextNode } from 'lexical'
import {
  $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND,
  TextNode,
} from 'lexical'
import { registerLexicalTextEntity } from '@lexical/text'
import { mergeRegister } from '@lexical/utils'
import { $getRoot } from 'lexical'
import { scanTextRefs } from '../decorations.ts'
import type { InputTriggerChar } from '../../contract/input.ts'
import css from './composer-editor.module.css'

/** JSON form of one text-ref node. */
export type SerializedTextRefNode = SerializedTextNode

/** One matched plain-text reference as a styled, fully editable text node. */
export class TextRefNode extends TextNode {
  /** Lexical node registry type tag. */
  static override getType(): string {
    return 'composer-text-ref'
  }

  /**
   * Clone with identity (Lexical writable-copy contract).
   * @param node - node to clone.
   * @returns a copy carrying the same NodeKey.
   */
  static override clone(node: TextRefNode): TextRefNode {
    return new TextRefNode(node.__text, node.__key)
  }

  /**
   * Rebuild one text-ref from its JSON form.
   * @param json - serialized node.
   * @returns a fresh node.
   */
  static override importJSON(json: SerializedTextRefNode): TextRefNode {
    const node = new TextRefNode(json.text)
    node.setFormat(json.format)
    node.setDetail(json.detail)
    node.setMode(json.mode)
    node.setStyle(json.style)
    return node
  }

  /** Serialize to the JSON node form. */
  override exportJSON(): SerializedTextRefNode {
    return {
      ...super.exportJSON(),
      type: 'composer-text-ref',
    }
  }

  /** Style the span the base TextNode mounts. */
  override createDOM(config: EditorConfig): HTMLElement {
    const el = super.createDOM(config)
    el.className = clsx(el.className, css.reference, css.textRef, this.getTextContent().startsWith('/') && css.openable)
    el.setAttribute('spellcheck', 'false')
    el.setAttribute('data-composer-text-ref', '')
    return el
  }

  /** Entity nodes never merge with plain siblings (the transform owns their bounds). */
  override isTextEntity(): true {
    return true
  }

  /** Editing continues inside; the transform re-evaluates match shape per edit. */
  override canInsertTextBefore(): boolean {
    return true
  }
}

/**
 * The whole token one collapsed-caret edit should remove, or null to let the
 * default character edit run.
 *
 * Backspace takes the token from inside it or from its trailing edge; Delete
 * from inside it or from its leading edge. The edge the gesture does not move
 * away from belongs to the neighbour — backspacing at a token's start, or
 * deleting at its end, is an ordinary edit of the text beside it.
 *
 * A caret parked at the far edge of a neighbouring node is still touching the
 * token, which is how Lexical represents the position just after an entity.
 *
 * @param node - the node holding the caret.
 * @param offset - the caret's offset inside that node.
 * @param forward - true for Delete, false for Backspace.
 * @returns the token to remove, or null.
 */
function $touchedToken(node: LexicalNode, offset: number, forward: boolean): TextRefNode | null {
  if (node instanceof TextRefNode) {
    if (forward) return offset < node.getTextContentSize() ? node : null
    return offset > 0 ? node : null
  }
  const sibling = forward ? node.getNextSibling() : node.getPreviousSibling()
  if (!(sibling instanceof TextRefNode)) return null
  const atEdge = forward ? offset === node.getTextContentSize() : offset === 0
  return atEdge ? sibling : null
}

/**
 * Remove one matched `/name` token whole rather than one character of it.
 *
 * A matched token is styled like a reference but is still an ordinary text node,
 * so the browser's own Backspace/Delete would take it apart a character at a
 * time — leaving a half-token the lexicon no longer matches and the person did
 * not mean to keep. A collapsed caret touching a token therefore removes the node
 * whole, which is what an atomic reference chip does; every other caret position
 * falls through to the default edit unchanged.
 *
 * @param editor - the shell-owned editor.
 * @returns the unregister disposer.
 */
export function registerTextRefDeletion(editor: LexicalEditor): () => void {
  const removeTouched = (forward: boolean) => (): boolean => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
    const anchor = selection.anchor
    if (anchor.type !== 'text') return false
    const token = $touchedToken(anchor.getNode(), anchor.offset, forward)
    if (token === null) return false
    token.remove()
    return true
  }
  return mergeRegister(
    editor.registerCommand(KEY_BACKSPACE_COMMAND, removeTouched(false), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_DELETE_COMMAND, removeTouched(true), COMMAND_PRIORITY_HIGH),
  )
}

/**
 * Register the plain-text reference entity transform. The claim decoration
 * has precedence on the leading-token seat: while a command claim holds, the
 * claimed token must stay a plain TextNode (transforms register per concrete
 * node class, so a TextRefNode would never receive the TextNode claim
 * transform and the warn color would be lost).
 * @param editor - the shell-owned editor.
 * @param lexiconOf - live per-trigger name-roll accessor (the controller's aggregated store).
 * @param activeToken - live claim token accessor; null while unclaimed.
 * @returns the unregister disposer.
 */
export function registerTextRefDecoration(
  editor: LexicalEditor,
  lexiconOf: () => ReadonlyMap<InputTriggerChar, readonly string[]>,
  activeToken: () => string | null,
): () => void {
  const getMatch = (text: string): { start: number; end: number } | null => {
    const claim = activeToken()
    for (const range of scanTextRefs(text, lexiconOf())) {
      if (claim !== null && range.start === 0 && text.slice(range.start, range.end) === claim.trimEnd()) continue
      return { start: range.start, end: range.end }
    }
    return null
  }
  return mergeRegister(
    ...registerLexicalTextEntity(
      editor,
      getMatch,
      TextRefNode,
      node => new TextRefNode(node.getTextContent()),
    ),
  )
}

/**
 * Force a re-scan of the whole document (transforms only visit dirty nodes;
 * a lexicon roll change dirties nothing on its own). Queued, not discrete —
 * the caller may sit inside an update listener.
 * @param editor - the shell-owned editor.
 */
export function rescanTextRefs(editor: LexicalEditor): void {
  editor.update(() => {
    for (const node of $getRoot().getAllTextNodes()) node.markDirty()
  })
}
