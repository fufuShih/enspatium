import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { moveObject } from '../../../api/generated/objects'
import { apiCode, apiStatus } from '../../../context/session'
import { fileErrorMessage, refreshObjectLists } from './objectFileApi'
import { planObjectMoves, type MoveItem, type MoveTarget } from './objectMoveApi'

export function useObjectMoves(account: string, slug: string) {
  const client = useQueryClient()
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const list = useRef<MoveItem[]>([])
  const [items, setItems] = useState<MoveItem[]>([])
  const [confirmation, setConfirmation] = useState<MoveTarget[] | null>(null)
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
        item.status = 'moving'; item.message = undefined; publish()
        try {
          // Keep both paths, identity and version unchanged across retries.
          // The server resolves an already completed move without another audit event.
          await moveObject(account, slug, { objectId: item.id, key: item.key, newKey: item.newKey, expectedVersion: item.versionId }, { signal: controller.signal })
          item.status = 'moved'; item.retryable = false
        } catch (failure) {
          const status = apiStatus(failure)
          const code = apiCode(failure)
          const changed = code === 'OBJECT_MOVE_CONFLICT' || status === 404
          item.status = controller.signal.aborted ? 'stopped' : 'failed'
          item.message = controller.signal.aborted ? 'Stopped. This file may already have moved; retry will check first.'
            : changed ? 'This file changed or moved. Review it and select it again.'
            : code === 'OBJECT_KEY_CONFLICT' ? 'The destination is used by a file, folder or deleted file. Nothing was overwritten. Resolve the conflict before retrying.'
            : fileErrorMessage(failure, 'move')
          item.retryable = controller.signal.aborted || (!changed && status !== 400)
          if (!controller.signal.aborted && (status === 401 || status === 403)) {
            if (status === 401) void client.invalidateQueries({ queryKey: ['session'] })
            controller.abort()
          }
        }
        publish()
      }
    } finally {
      for (const item of list.current) if (item.status === 'queued') { item.status = 'stopped'; item.message = 'Not moved.' }
      publish()
      // An aborted request may have committed. Refresh independently of its outcome.
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
    ask: (targets: MoveTarget[]) => { if (!operation.current && targets.length) setConfirmation(targets.map(({ id, key, versionId }) => ({ id, key, versionId }))) },
    cancel: () => setConfirmation(null),
    confirm: (folder: string) => {
      if (operation.current || !confirmation) return false
      const planned = planObjectMoves(confirmation, folder)
      if (!planned) return false
      list.current = planned
      setConfirmation(null); publish(); void run()
      return true
    },
    retry, stop: () => operation.current?.abort(),
    clear: () => { if (!operation.current) { list.current = []; publish(); setError('') } },
  }
}

export type ObjectMoves = ReturnType<typeof useObjectMoves>
