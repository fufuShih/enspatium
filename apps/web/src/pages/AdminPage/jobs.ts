import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { GetAdminJob200 } from '../../api/generated/api.schemas'
import { apiStatus } from '../../context/session'

export const unfinished = (job: { status: string }) => job.status === 'queued' || job.status === 'running'
export const jobKeys = (userId: string) => ['admin-jobs', userId] as const

export function useJobAccess(error: unknown, userId: string) {
  const client = useQueryClient()
  const denied = [401, 403].includes(apiStatus(error) ?? 0)
  useEffect(() => {
    if (!denied) return
    void client.cancelQueries({ queryKey: jobKeys(userId) }).then(() => {
      client.removeQueries({ queryKey: jobKeys(userId) })
      return client.invalidateQueries({ queryKey: ['session'] })
    })
  }, [denied, client, userId])
  return denied
}

export function useJobAction(userId: string) {
  const client = useQueryClient()
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const denied = useJobAccess(error, userId)
  useEffect(() => () => { request.current?.abort() }, [])
  async function run(operation: (signal: AbortSignal) => Promise<GetAdminJob200>, success: (job: GetAdminJob200) => void) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(null)
    try {
      const job = await operation(controller.signal)
      if (controller.signal.aborted) return
      await client.cancelQueries({ queryKey: jobKeys(userId) })
      if (controller.signal.aborted) return
      client.setQueryData([...jobKeys(userId), 'detail', job.id], job)
      void client.invalidateQueries({ queryKey: [...jobKeys(userId), 'list'] })
      success(job)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure)
      if (apiStatus(failure) === 409) void client.invalidateQueries({ queryKey: jobKeys(userId) })
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false) }
    }
  }
  return { run, pending, error, denied }
}

export function jobError(error: unknown) {
  const status = apiStatus(error)
  return status === 409 ? 'The job state changed, or a storage check is already pending. Refresh Jobs before trying again.'
    : status === 400 ? 'Check the Space ID and job details. The requested Space may no longer exist.'
    : status === 401 || status === 403 ? 'Site administrator access is required.'
    : status === 404 ? 'This job could not be found.'
    : 'The request could not be confirmed. Refresh Jobs before trying again.'
}
