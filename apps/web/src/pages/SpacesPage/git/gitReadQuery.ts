import { apiCode, apiStatus } from '../../../context/session'

// Briefly retry capacity rejections for read queries only. Maintenance can
// last longer, so stop after two attempts and retain the normal manual retry.
export const gitReadRetry = {
  retry: (failures: number, error: unknown) => failures < 2 && apiStatus(error) === 503 && apiCode(error) === 'GIT_BUSY',
  retryDelay: (attempt: number) => 1000 * (attempt + 1),
}
