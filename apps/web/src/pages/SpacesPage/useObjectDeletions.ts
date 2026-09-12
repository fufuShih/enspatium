import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiCode, apiStatus } from '../../context/session'
import { deleteSelectedObject, type DeleteItem, type DeleteTarget } from './objectDeletion'
import { fileErrorMessage, refreshObjectLists } from './objectFileApi'

export function useObjectDeletions(account: string, slug: string) {
  const client = useQueryClient()
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const list = useRef<DeleteItem[]>([])
  const [items, setItems] = useState<DeleteItem[]>([])
  const [confirmation, setConfirmation] = useState<DeleteTarget[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current?.abort() }
  }, [])
  function publish() { if (mounted.current) setItems([...list.current]) }

  async function run() {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setError('')
    try {
      for (const item of list.current) {
        if (controller.signal.aborted) break
        if (item.status !== 'queued') continue
        item.status = 'deleting'; item.message = undefined; publish()
        try {
          item.message = await deleteSelectedObject(account, slug, item, controller.signal)
          item.status = 'deleted'; item.retryable = false
        } catch (failure) {
          const status = apiStatus(failure)
          const changed = status === 409 && apiCode(failure) !== 'STORAGE_BUSY'
          item.status = controller.signal.aborted ? 'stopped' : 'failed'
          item.message = controller.signal.aborted ? 'Stopped. This file may already be deleted; retry will check first.'
            : changed ? 'This file changed. Review it and select it again before deleting.' : fileErrorMessage(failure, 'delete')
          item.retryable = controller.signal.aborted || (!changed && status !== 400 && status !== 404)
          if (!controller.signal.aborted && (status === 401 || status === 403)) {
            if (status === 401) void client.invalidateQueries({ queryKey: ['session'] })
            controller.abort()
          }
        }
        publish()
      }
    } finally {
      for (const item of list.current) if (item.status === 'queued') { item.status = 'stopped'; item.message = 'Not deleted.' }
      publish()
      // Invalidate after cancellation too: the server may already have committed.
      // Refresh failures must not turn successful deletes into retryable failures.
      try { await refreshObjectLists(client, account, slug) }
      catch { if (mounted.current) setError('The file list could not refresh. Reload to see the latest files.') }
      if (mounted.current) setBusy(false)
      if (operation.current === controller) operation.current = null
    }
  }

  function retry(id?: string) {
    if (operation.current) return
    const targets = list.current.filter(item => item.retryable && (item.status === 'failed' || item.status === 'stopped') && (!id || item.id === id))
    if (!targets.length) return
    for (const item of targets) item.status = 'queued'
    publish(); void run()
  }

  return { items, busy, error, confirmation,
    ask: (targets: DeleteTarget[]) => { if (!operation.current && targets.length) setConfirmation(targets.map(({ id, key, versionId }) => ({ id, key, versionId }))) },
    cancel: () => setConfirmation(null),
    confirm: () => {
      if (operation.current || !confirmation?.length) return
      list.current = confirmation.map(target => ({ ...target, status: 'queued', retryable: true }))
      setConfirmation(null); publish(); void run()
    },
    retry, stop: () => operation.current?.abort(),
    clear: () => { if (!operation.current) { list.current = []; publish(); setError('') } },
  }
}

export type ObjectDeletions = ReturnType<typeof useObjectDeletions>
