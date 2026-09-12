import { EditorState, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

class Bullet extends WidgetType {
  toDOM() {
    const span = document.createElement('span')
    span.textContent = '•'
    span.className = 'note-bullet'
    return span
  }
  eq() { return true }
}

export function safeNoteLink(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

export function previewDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const active = (from: number, to: number) => !state.readOnly && state.selection.ranges.some(range =>
    state.doc.lineAt(range.from).from <= to && state.doc.lineAt(range.to).to >= from)
  const mark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to))
  }
  syntaxTree(state).iterate({ enter(node) {
    const { name, from, to } = node
    if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
      ranges.push(Decoration.line({ class: `note-heading note-h${name.at(-1)}` }).range(state.doc.lineAt(from).from))
    }
    if (name === 'StrongEmphasis') mark(from, to, 'note-strong')
    if (name === 'Emphasis') mark(from, to, 'note-emphasis')
    if (name === 'Strikethrough') mark(from, to, 'note-strike')
    if (name === 'InlineCode') mark(from, to, 'note-code')
    if (name === 'FencedCode' || name === 'CodeBlock' || name === 'Blockquote') {
      for (let line = state.doc.lineAt(from); line.from <= to; line = state.doc.line(line.number + 1)) {
        ranges.push(Decoration.line({ class: name === 'Blockquote' ? 'note-quote' : 'note-code-block' }).range(line.from))
        if (line.number === state.doc.lines || line.to >= to) break
      }
    }
    if (name === 'Link' && !active(from, to)) {
      const url = node.node.getChild('URL')
      const href = url && safeNoteLink(state.sliceDoc(url.from, url.to))
      if (href) ranges.push(Decoration.mark({ tagName: 'a', class: 'note-link', attributes: { href, target: '_blank', rel: 'noopener noreferrer', title: 'Ctrl / Cmd + click to open link' } }).range(from, to))
    }
    const line = state.doc.lineAt(from)
    // Replacements only hide inline syntax. The source document is never rewritten.
    if (name === 'HeaderMark' || name === 'EmphasisMark' || name === 'CodeMark' || name === 'QuoteMark' || name === 'StrikethroughMark') {
      if (!active(from, to) && to <= line.to) ranges.push(Decoration.replace({}).range(from, to))
      else mark(from, to, 'note-syntax')
    }
    if (name === 'ListMark' && !active(from, to) && /^[-+*]$/.test(state.sliceDoc(from, to))) {
      ranges.push(Decoration.replace({ widget: new Bullet() }).range(from, to))
    }
    if ((name === 'LinkMark' || name === 'URL' || name === 'LinkTitle') && node.node.parent?.name === 'Link') {
      const parent = node.node.parent
      if (!active(parent.from, parent.to) && to <= line.to) ranges.push(Decoration.replace({}).range(from, to))
    }
  } })
  return Decoration.set(ranges, true)
}

export const markdownPreview = StateField.define({
  create: previewDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.reconfigured || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? previewDecorations(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field),
})
