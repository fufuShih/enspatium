import { describe, expect, test } from 'vitest'
import { newObjectFolder, objectFolderMarkerKey, objectFolderPath } from './objectFolderApi'

describe('object folders', () => {
  test('builds persistent nested folder paths', () => {
    expect(objectFolderPath(' Projects/Ideas/ ')).toBe('Projects/Ideas/')
    expect(objectFolderMarkerKey('Projects/Ideas/')).toBe('Projects/Ideas/.enspatium-folder')
  })

  test('rejects invalid folder paths', () => {
    for (const path of ['', '../outside', 'folder//nested', '/root', 'bad:name']) expect(objectFolderPath(path)).toBeNull()
    expect(newObjectFolder('Projects/', 'Notes')).toBe('Projects/Notes/')
  })
})
