import { Box, Flex, Text } from '@chakra-ui/react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { useEffect, useRef } from 'react'
import { ActionButton } from '../../../../components/ui/Primitives'
import { markdownPreview } from './markdownPreview'

type Props = { initialContent: string; editable: boolean; onChange: (text: string) => void; onSave: () => void }

export default function NoteEditor({ initialContent, editable, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const access = useRef(new Compartment())
  const callbacks = useRef({ onChange, onSave })
  useEffect(() => { callbacks.current = { onChange, onSave } }, [onChange, onSave])
  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: initialContent, extensions: [
        markdown({ base: markdownLanguage, completeHTMLTags: false }), history(), drawSelection(), EditorView.lineWrapping,
        // Match the file's standard newline convention when editing imported notes.
        EditorState.lineSeparator.of(initialContent.includes('\r\n') ? '\r\n' : '\n'),
        access.current.of([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
        EditorView.contentAttributes.of({ 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' }),
        placeholder('Start writing. Use # for headings, **bold**, or - for a list.'),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }, ...defaultKeymap, ...historyKeymap]),
        markdownPreview,
        EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc()) }),
        EditorView.domEventHandlers({ click(event) {
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.note-link')
          if (!link) return false
          event.preventDefault()
          if (event.ctrlKey || event.metaKey || editor.state.readOnly) window.open(link.href, '_blank', 'noopener,noreferrer')
          return false
        } }),
      ] }),
    })
    view.current = editor
    return () => { view.current = null; editor.destroy() }
    // The parent keys this component by the opened document; updates must not reset selection or history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    view.current?.dispatch({ effects: access.current.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]) })
  }, [editable])

  function insert(before: string, after = '') {
    const editor = view.current
    if (!editor || editor.state.readOnly) return
    const { from, to } = editor.state.selection.main
    const selected = editor.state.sliceDoc(from, to)
    editor.dispatch({ changes: { from, to, insert: before + selected + after }, selection: { anchor: from + before.length, head: from + before.length + selected.length } })
    editor.focus()
  }
  function prefixLine(prefix: string) {
    const editor = view.current
    if (!editor || editor.state.readOnly) return
    const line = editor.state.doc.lineAt(editor.state.selection.main.head)
    const currentPrefix = /^(#{1,6} |[-*+] )/.exec(line.text)?.[0] ?? ''
    editor.dispatch({ changes: { from: line.from, to: line.from + currentPrefix.length, insert: currentPrefix === prefix ? '' : prefix } })
    editor.focus()
  }
  return <Box minW="0">
    <Flex align="center" gap="4px" borderBottom="1px solid var(--border)" pb="12px" mb="24px" wrap="wrap">
      {editable ? <>
        <ActionButton aria-label="Heading" onClick={() => prefixLine('## ')} border="0" p="6px 10px">H2</ActionButton>
        <ActionButton aria-label="Bold" onClick={() => insert('**', '**')} border="0" p="6px 10px" fontWeight="700">B</ActionButton>
        <ActionButton aria-label="Italic" onClick={() => insert('*', '*')} border="0" p="6px 10px" fontStyle="italic">I</ActionButton>
        <ActionButton aria-label="Bullet list" onClick={() => prefixLine('- ')} border="0" p="6px 10px">List</ActionButton>
        <Text ml="auto" fontSize="11px" color="var(--muted)">Markdown · Ctrl / ⌘ S to save</Text>
      </> : <Text fontSize="12px" color="var(--muted)">Read only</Text>}
    </Flex>
    <Box ref={host} minH="50dvh" css={{
      '& .cm-editor': { background: 'transparent', color: 'var(--foreground)', fontSize: '15px' },
      '& .cm-editor.cm-focused': { outline: 'none' },
      '& .cm-scroller': { fontFamily: 'inherit', lineHeight: '1.9', overflow: 'visible' },
      '& .cm-content': { padding: '0 0 100px', caretColor: 'var(--foreground)', minHeight: '50dvh' },
      '& .cm-line': { padding: '0', overflowWrap: 'anywhere' },
      '& .cm-cursor': { borderLeftColor: 'var(--foreground)' },
      '& .cm-selectionBackground, & .cm-focused .cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 25%, transparent) !important' },
      '& .cm-placeholder, & .note-syntax': { color: 'var(--muted)' },
      '& .note-heading': { fontWeight: '600', lineHeight: '1.5', paddingTop: '16px', paddingBottom: '8px' },
      '& .note-h1': { fontSize: '30px', letterSpacing: '-.03em' },
      '& .note-h2': { fontSize: '24px' },
      '& .note-h3': { fontSize: '20px' },
      '& .note-strong': { fontWeight: '700' },
      '& .note-emphasis': { fontStyle: 'italic' },
      '& .note-strike': { textDecoration: 'line-through' },
      '& .note-code, & .note-code-block': { fontFamily: 'monospace', background: 'var(--surface)', fontSize: '13px' },
      '& .note-code': { padding: '2px 3px', borderRadius: '4px' },
      '& .note-code-block': { paddingInline: '14px' },
      '& .note-quote': { borderLeft: '2px solid var(--accent)', paddingLeft: '16px', color: 'var(--muted)' },
      '& .note-link': { color: 'var(--accent-ink)', textDecoration: 'underline', cursor: 'pointer' },
      '& .note-bullet': { color: 'var(--muted)' },
    }} />
  </Box>
}
