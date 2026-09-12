import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { createDb } from '../db/index.js'
import { checkStorage } from '../services/storage-check/index.js'
import { getSpaceStoragePath } from '../services/space/storage.js'
import { execGit } from '../services/git/process.js'

// Host recovery tooling runs this in an isolated container against restored
// volumes, before starting the service or applying any new migrations.
const databaseUrl = process.env.DATABASE_URL
const dataRoot = process.env.DATA_ROOT
if (!databaseUrl || !dataRoot) throw new Error('DATABASE_URL and DATA_ROOT are required')
const db = createDb(databaseUrl)
try {
  const report = await checkStorage(db, dataRoot, { deep: true }, AbortSignal.timeout(30 * 60 * 1000))
  if (report.status !== 'ok' || !report.complete) {
    throw new Error('Restored storage integrity check failed: ' + [...new Set(report.issues.map(issue => issue.code))].join(', '))
  }
  let gitRepositories = 0
  for (const space of report.spaces.filter(space => space.type === 'git')) {
    const root = await mkdtemp(join(tmpdir(), 'enspatium-restore-clone-'))
    const repository = getSpaceStoragePath(dataRoot, space.id)
    const clone = join(root, 'mirror.git')
    const options = { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }
    try {
      // --no-local exercises upload-pack and prevents shared/hard-linked data.
      await execGit(['-c', 'core.hooksPath=/dev/null', 'clone', '--mirror', '--no-local', '--', repository, clone], options)
      const refs = ['for-each-ref', '--sort=refname', '--format=%(refname) %(objectname)']
      const sourceRefs = await execGit(['--git-dir=' + repository, ...refs], options)
      const restoredRefs = await execGit(['--git-dir=' + clone, ...refs], options)
      if (sourceRefs.stdout !== restoredRefs.stdout) throw new Error('Restored Git clone refs differ')
      const sourceHead = await execGit(['--git-dir=' + repository, 'symbolic-ref', 'HEAD'])
      const cloneHead = await execGit(['--git-dir=' + clone, 'symbolic-ref', 'HEAD'])
      if (sourceHead.stdout !== cloneHead.stdout) throw new Error('Restored Git clone HEAD differs')
      await execGit(['--git-dir=' + clone, 'fsck', '--full', '--strict'], options)
      gitRepositories++
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  const result = await sql<{ users: string; versions: string }>`SELECT
    (SELECT count(*)::text FROM users) AS users,
    (SELECT count(*)::text FROM space_object_versions) AS versions`.execute(db)
  console.log(JSON.stringify({
    status: 'ok', verifiedAt: new Date().toISOString(), users: Number(result.rows[0]!.users),
    spaces: report.spaces.length, gitRepositories,
    objectVersions: Number(result.rows[0]!.versions),
    filesChecked: report.spaces.reduce((total, space) => total + space.filesChecked, 0),
    hashesChecked: report.spaces.reduce((total, space) => total + space.hashesChecked, 0),
  }))
} catch (error) {
  // Do not expose connection strings or file contents in operator diagnostics.
  console.error(error instanceof Error && error.message.startsWith('Restored ')
    ? error.message : 'Restored data verification failed. Inspect the isolated recovery environment.')
  process.exitCode = 1
} finally { await db.destroy() }
