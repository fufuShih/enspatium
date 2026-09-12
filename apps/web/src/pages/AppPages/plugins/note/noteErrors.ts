import { apiStatus } from '../../../../context/session'
import { fileErrorMessage } from '../../../SpacesPage/object/objectFileApi'

export function noteError(error: unknown, creating = false) {
  if (apiStatus(error) === 409) return creating
    ? 'This name is already in use. Choose another note name.'
    : 'This note changed elsewhere. Your edits are still here. Download your draft before reloading the latest version.'
  if (!apiStatus(error) && error instanceof Error && error.message) return error.message
  return fileErrorMessage(error, creating ? 'upload' : 'preview')
}
