import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiCode, apiStatus } from '../../../context/session'
import { fileErrorMessage, refreshObjectLists, uploadFile } from './objectFileApi'
import { prepareUploads, readDroppedFiles, selectFiles, type UploadItem, type UploadSelection } from './uploadSelection'

export function useObjectUploads(account: string, slug: string) {
  const client = useQueryClient()
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const list = useRef<UploadItem[]>([])
  const [items, setItems] = useState<UploadItem[]>([])
  const [phase, setPhase] = useState<'reading' | 'uploading' | null>(null)
  const [destination, setDestination] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [emptyFolders, setEmptyFolders] = useState(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current?.abort() }
  }, [])

  function publish() { if (mounted.current) setItems([...list.current]) }

  async function run(controller: AbortController) {
    const { signal } = controller
    if (mounted.current) setPhase('uploading')
    try {
      for (const item of list.current) {
        if (signal.aborted) break
        if (item.status !== 'queued' || !item.file) continue
        item.status = 'uploading'
        item.message = undefined
        publish()
        try {
          await uploadFile(account, slug, item.file, signal, '', item.attempt)
          item.status = 'uploaded'
          item.retryable = false
          item.file = undefined // Release successful file handles and bytes.
        } catch (failure) {
          item.status = signal.aborted ? 'stopped' : 'failed'
          item.message = signal.aborted ? 'Stopped. Check the result before retrying.' : fileErrorMessage(failure, 'upload')
          item.retryable = apiCode(failure) !== 'UPLOAD_VERSION_CHANGED'
          if (!signal.aborted && (apiStatus(failure) === 401 || apiStatus(failure) === 403)) {
            if (apiStatus(failure) === 401) void client.invalidateQueries({ queryKey: ['session'] })
            controller.abort()
          }
        }
        publish()
      }
    } finally {
      for (const item of list.current) if (item.status === 'queued') { item.status = 'stopped'; item.message = 'Not uploaded.' }
      publish()
      // Refresh usage, versions and all folder/App lists, even if a response was lost.
      // A refresh failure must not turn a confirmed upload into a retryable failure.
      if (mounted.current) {
        try { await refreshObjectLists(client, account, slug) }
        catch { if (mounted.current) setError('Uploads finished, but the file list could not refresh. Reload to see the latest files.') }
      }
      if (mounted.current) {
        const successful = list.current.filter(item => item.status === 'uploaded').length
        setNotice(list.current.length === 1 && successful === 1 ? `Uploaded ${list.current[0]!.path}.` : `${successful} of ${list.current.length} files uploaded.`)
        setPhase(null)
      }
      if (operation.current === controller) operation.current = null
    }
  }

  async function add(read: (signal: AbortSignal) => Promise<UploadSelection>, prefix: string) {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setPhase('reading'); setError(''); setNotice(''); setEmptyFolders(0); setDestination(prefix)
    list.current = []; publish()
    try {
      const selection = await read(controller.signal)
      if (controller.signal.aborted) return
      list.current = prepareUploads(selection, prefix)
      setEmptyFolders(selection.emptyFolders)
      publish()
      if (!list.current.length) { setNotice('Nothing to upload. Empty folders are not stored.'); return }
      await run(controller)
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : 'Unable to read these files. Select them again.')
    } finally {
      if (controller.signal.aborted && !list.current.length && mounted.current) setNotice('Reading stopped. No files were uploaded.')
      if (mounted.current) setPhase(null)
      if (operation.current === controller) operation.current = null
    }
  }

  function retry(id?: string) {
    if (operation.current) return
    const retryItems = list.current.filter(item => item.retryable && (item.status === 'failed' || item.status === 'stopped') && (!id || item.id === id))
    if (!retryItems.length) return
    for (const item of retryItems) item.status = 'queued'
    publish(); setError(''); setNotice('')
    const controller = new AbortController()
    operation.current = controller
    void run(controller)
  }

  return { items, phase, destination, notice, error, emptyFolders,
    addFiles: (files: File[], prefix: string) => add(async () => selectFiles(files), prefix),
    drop: (data: DataTransfer, prefix: string) => add(signal => readDroppedFiles(data, signal), prefix),
    retry, stop: () => operation.current?.abort(),
    clear: () => { if (!operation.current) { list.current = []; publish(); setNotice(''); setError(''); setEmptyFolders(0) } },
  }
}

export type ObjectUploads = ReturnType<typeof useObjectUploads>
