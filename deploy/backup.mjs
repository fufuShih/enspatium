import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repository = fileURLToPath(new URL('../', import.meta.url))
const composeFile = join(repository, 'compose.yaml')
const projectPattern = /^[a-z0-9][a-z0-9_-]{0,40}$/
const imagePattern = /^sha256:[a-f0-9]{64}$/
const artifacts = ['database.dump', 'content.tar.gz', 'images.tar', 'compose.yaml', 'images.json']
const progress = message => console.error('[backup] ' + message)

// Never print subprocess arguments, environment or raw stderr: database dumps
// and Docker diagnostics can contain credentials or private repository data.
async function docker(args, { input, output, timeout = 30 * 60 * 1000 } = {}) {
  const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let result = ''
  let diagnostic = ''
  let failed = false
  const timer = setTimeout(() => { failed = true; child.kill() }, timeout)
  child.stderr.on('data', chunk => { if (diagnostic.length < 64 * 1024) diagnostic += chunk.toString('utf8') })
  if (!output) child.stdout.on('data', chunk => {
    if (result.length + chunk.length > 8 * 1024 * 1024) { failed = true; child.kill() }
    else result += chunk.toString('utf8')
  })
  const operations = [new Promise((accept, reject) => {
    child.once('error', () => reject(new Error('Unable to start Docker.')))
    child.once('close', code => {
      if (code === 0 && !failed) { accept(); return }
      const safeDetail = diagnostic.split('\n').filter(line => /^Restored (storage integrity check failed: [A-Z_, ]+|Git clone (refs|HEAD) differ|data verification failed\.)/.test(line)).join('\n')
      reject(new Error(safeDetail || 'Docker operation failed: ' + args[0] + ' (exit ' + code + '). Check the selected deployment and available disk space.'))
    })
  })]
  if (input) operations.push(pipeline(createReadStream(input), child.stdin))
  else child.stdin.end()
  if (output) operations.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })))
  try { await Promise.all(operations); return result.trim() }
  catch (error) { child.kill(); await Promise.allSettled(operations); throw error }
  finally { clearTimeout(timer) }
}

function compose(envFile, project, file = composeFile, override) {
  if (!projectPattern.test(project)) throw new Error('Use a project name of 1–41 lowercase letters, digits, underscores or hyphens.')
  const base = ['compose', '--env-file', resolve(envFile), '-p', project, '-f', file]
  if (override) base.push('-f', override)
  return (args, options) => docker([...base, ...args], options)
}

async function inspect(id) {
  const format = '{"id":"{{.Id}}","image":"{{.Image}}","state":{{json .State}},"mounts":{{json .Mounts}}}'
  return JSON.parse(await docker(['inspect', '--format', format, id]))
}

async function service(composeCommand, serviceName) {
  const ids = (await composeCommand(['ps', '-a', '-q', serviceName])).split(/\s+/).filter(Boolean)
  if (ids.length !== 1) throw new Error('Expected exactly one ' + serviceName + ' container.')
  return inspect(ids[0])
}

function volume(container, destination) {
  const mount = container.mounts.find(item => item.Destination === destination && item.Type === 'volume')
  if (!mount || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(mount.Name)) throw new Error('Expected a named volume at ' + destination)
  return mount.Name
}

async function waitHealthy(id) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const container = await inspect(id)
    if (container.state.Running && (!container.state.Health || container.state.Health.Status === 'healthy')) return
    if (!container.state.Running) throw new Error('Container exited before becoming healthy.')
    await new Promise(accept => setTimeout(accept, 1000))
  }
  throw new Error('Container did not become healthy within two minutes.')
}

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function helper(args, options) {
  // Capture the ID only after successful creation; cleanup never removes a
  // pre-existing container, even if a name collides or creation fails.
  const id = await docker(['create', '-i', '--name', 'ensp-backup-helper-' + randomUUID(), ...args])
  try { return await docker(['start', '--attach', '--interactive', id], options) }
  finally { await docker(['rm', '--force', id]) }
}

async function createBackup(options) {
  const envFile = options['env-file'] ?? join(repository, 'deploy/.env')
  const project = options.project ?? 'enspatium'
  const command = compose(envFile, project)
  const [server, web, db] = await Promise.all(['server', 'web', 'db'].map(name => service(command, name)))
  for (const item of [server, web, db]) {
    if (!item.state.Running || (item !== web && item.state.Health?.Status !== 'healthy')) throw new Error('Start a healthy deployment before taking a backup.')
  }
  const contentVolume = volume(server, '/data')
  await docker(['exec', server.id, 'node', '-e', "require('node:fs').accessSync('packages/server/dist/scripts/verify-backup.js')"])
  const images = { server: server.image, web: web.image, db: db.image }
  if (!Object.values(images).every(id => imagePattern.test(id))) throw new Error('Invalid deployment image ID.')
  const output = resolve(options.output ?? join(repository, 'backups', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID()))
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await mkdir(output, { mode: 0o700 }) // Existing backups are never overwritten.
  const lock = await docker(['create', '--name', 'ensp-backup-lock-' + project, '--entrypoint', 'true', server.image])
  let stoppedWeb = false
  let cleanStop = false
  let verifiedSnapshot = false
  try {
    progress('Saving the exact running images before the maintenance window.')
    await docker(['image', 'save', ...new Set(Object.values(images))], { output: join(output, 'images.tar') })
    await writeFile(join(output, 'compose.yaml'), await readFile(composeFile), { flag: 'wx', mode: 0o600 })
    await writeFile(join(output, 'images.json'), JSON.stringify({ services: {
      db: { image: images.db, pull_policy: 'never' },
      server: { image: images.server, pull_policy: 'never' },
      migrate: { image: images.server, pull_policy: 'never' },
      web: { image: images.web, pull_policy: 'never' },
    } }, null, 2), { flag: 'wx', mode: 0o600 })
    progress('Stopping web traffic and waiting for backend writes to finish.')
    await docker(['stop', '--time', '30', web.id])
    stoppedWeb = true
    // A push can spend five minutes uploading plus five minutes in Git.
    await docker(['stop', '--time', '660', server.id])
    const stopped = await inspect(server.id)
    if (stopped.state.Running || stopped.state.ExitCode !== 0 || stopped.state.OOMKilled) {
      throw new Error('The backend did not stop cleanly. No complete backup was produced; inspect the stopped deployment before restarting it.')
    }
    cleanStop = true
    progress('Copying PostgreSQL and content while service writers are stopped.')
    await docker(['exec', db.id, 'pg_dump', '-U', 'enspatium', '-d', 'enspatium', '--format=custom'], { output: join(output, 'database.dump') })
    await helper(['--network', 'none', '--read-only', '--user', '0', '--mount', `type=volume,source=${contentVolume},target=/data,readonly`,
      '--entrypoint', 'tar', server.image, '-C', '/data', '-czf', '-', '.'], { output: join(output, 'content.tar.gz') })
    const after = await inspect(server.id)
    if (after.state.Running || after.state.StartedAt !== stopped.state.StartedAt || after.state.FinishedAt !== stopped.state.FinishedAt) {
      throw new Error('The backend changed during backup. The snapshot is incomplete.')
    }
    verifiedSnapshot = true
  } finally {
    try {
      if (cleanStop) {
        progress('Resuming the original containers.')
        await docker(['start', server.id])
        await waitHealthy(server.id)
        await docker(['start', web.id])
        await waitHealthy(web.id)
      } else if (stoppedWeb) {
        progress('The deployment remains stopped because shutdown was not clean. Inspect it before restarting.')
      }
    } finally { await docker(['rm', lock]) }
  }
  if (!verifiedSnapshot) throw new Error('Backup snapshot was not completed.')
  progress('Hashing backup artifacts.')
  const files = {}
  for (const name of artifacts) files[name] = { bytes: (await lstat(join(output, name))).size, sha256: await digest(join(output, name)) }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), sourceProject: project, images, files }, null, 2), { flag: 'wx', mode: 0o600 })
  return { status: 'created', backup: output, message: 'Run verify before relying on this backup. Keep the deployment env file separately and securely.' }
}

async function readBackup(directory) {
  const root = resolve(directory)
  const info = await lstat(join(root, 'manifest.json'))
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('Invalid or incomplete backup manifest.')
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (manifest.format !== 1 || typeof manifest.sourceProject !== 'string' || !projectPattern.test(manifest.sourceProject) || !['server', 'web', 'db'].every(name => imagePattern.test(manifest.images?.[name]))) {
    throw new Error('Unsupported backup manifest.')
  }
  for (const name of artifacts) {
    const file = await lstat(join(root, name))
    if (!file.isFile() || file.isSymbolicLink() || file.size !== manifest.files?.[name]?.bytes || await digest(join(root, name)) !== manifest.files[name].sha256) {
      throw new Error('Backup checksum or size does not match: ' + name)
    }
  }
  // Use only the expected, pinned service images from the checked manifest.
  const override = JSON.parse(await readFile(join(root, 'images.json'), 'utf8'))
  const expected = { services: Object.fromEntries(['db', 'server', 'migrate', 'web'].map(name => [name, { image: manifest.images[name === 'migrate' ? 'server' : name], pull_policy: 'never' }])) }
  if (JSON.stringify(override) !== JSON.stringify(expected)) throw new Error('Backup image overrides do not match the manifest.')
  return { root, manifest }
}

async function restoreBackup(options, keep) {
  if (!options.backup) throw new Error('--backup is required.')
  if (keep && !options.project) throw new Error('Restore requires --project with a new deployment name.')
  progress('Verifying every artifact before creating a recovery environment.')
  const { root, manifest } = await readBackup(options.backup)
  const project = keep ? options.project : 'ensp-verify-' + randomUUID().replaceAll('-', '').slice(0, 16)
  if (project === manifest.sourceProject) throw new Error('Restore must use a new project, never the source deployment.')
  const envFile = resolve(options['env-file'] ?? join(repository, 'deploy/.env'))
  const command = compose(envFile, project, join(root, 'compose.yaml'), join(root, 'images.json'))
  const config = JSON.parse(await command(['config', '--format', 'json']))
  validateRecoveryConfig(config, project, manifest.images)
  progress('Loading the saved images.')
  await docker(['image', 'load'], { input: join(root, 'images.tar') })
  for (const id of Object.values(manifest.images)) await docker(['image', 'inspect', '--format', '{{.Id}}', id])
  const lock = await docker(['create', '--name', 'ensp-backup-lock-' + project, '--entrypoint', 'true', manifest.images.server])
  let created = false
  let succeeded = false
  try {
    // A project can retain volumes even when all its containers were removed.
    const existing = await docker(['ps', '-a', '-q', '--filter', 'label=com.docker.compose.project=' + project])
    const volumes = await docker(['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])
    const networks = await docker(['network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])
    if (existing || volumes || networks) throw new Error('Recovery project already has resources. Choose a new project name.')
    for (const suffix of ['database', 'content', 'certificates', 'caddy_config']) {
      const names = await docker(['volume', 'ls', '-q', '--filter', 'name=^' + project + '_' + suffix + '$'])
      if (names) throw new Error('Recovery volume already exists. Choose a new project name.')
    }
    progress('Creating fresh database/content volumes.')
    // Set before creation so even partially-created owned resources are cleaned.
    created = true
    await command(['up', '-d', '--no-build', '--wait', 'db'])
    await command(['up', '--no-start', '--no-build', '--no-deps', 'server'])
    const db = await service(command, 'db')
    const server = await service(command, 'server')
    const contentVolume = volume(server, '/data')
    progress('Restoring the dump and content into the new project.')
    await docker(['exec', '-i', db.id, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '-U', 'enspatium', '-d', 'enspatium'], { input: join(root, 'database.dump') })
    // Only a brand-new named volume is writable; no host directory or original
    // data volume is exposed to the extraction container.
    await helper(['--network', 'none', '--read-only', '--user', '0', '--mount', `type=volume,source=${contentVolume},target=/data`,
      '--entrypoint', 'tar', manifest.images.server, '-C', '/data', '-xzf', '-'], { input: join(root, 'content.tar.gz') })
    progress('Checking every stored version and cloning every Git repository.')
    const verification = JSON.parse(await command(['run', '--rm', '--no-deps', '-T', 'server', 'node', 'packages/server/dist/scripts/verify-backup.js']))
    if (verification.status !== 'ok') throw new Error('Restored data verification did not succeed.')
    await command(['stop', 'db'])
    succeeded = true
    return { status: keep ? 'restored' : 'verified', project, backup: root, verification,
      ...(keep ? { envFile, composeFile: join(root, 'compose.yaml'), imageOverride: join(root, 'images.json'), message: 'Restored services are stopped. Start this project with the saved Compose files and --no-build --wait after checking the target hostname and ports.' } : {}),
    }
  } finally {
    try {
      if (created && (!keep || !succeeded)) {
        progress('Removing only the newly-created recovery project and its volumes.')
        await command(['down', '--volumes', '--remove-orphans'])
      }
    } finally { await docker(['rm', lock]) }
  }
}

function validateRecoveryConfig(config, project, images) {
  const fail = () => { throw new Error('Backup Compose configuration is not an isolated supported deployment.') }
  if (config.name !== project || Object.keys(config.services ?? {}).sort().join(',') !== 'db,migrate,server,web') fail()
  for (const [name, definition] of Object.entries(config.volumes ?? {})) {
    if (!['database', 'content', 'certificates', 'caddy_config'].includes(name) || definition.name !== project + '_' + name || definition.external || definition.driver_opts) fail()
  }
  for (const [name, definition] of Object.entries(config.networks ?? {})) {
    if (!['backend', 'edge'].includes(name) || definition.name !== project + '_' + name || definition.external || definition.driver_opts) fail()
  }
  const mounts = { db: { '/var/lib/postgresql/data': 'database' }, server: { '/data': 'content' }, migrate: {}, web: { '/data': 'certificates', '/config': 'caddy_config' } }
  for (const [name, definition] of Object.entries(config.services)) {
    if (definition.image !== images[name === 'migrate' ? 'server' : name] || definition.container_name || definition.privileged || definition.network_mode || definition.pid || definition.devices || definition.cap_add) fail()
    for (const mount of definition.volumes ?? []) {
      if (mount.type !== 'volume' || mounts[name][mount.target] !== mount.source) fail()
    }
    if ((definition.volumes ?? []).length !== Object.keys(mounts[name]).length) fail()
  }
  if (config.services.server.environment.DATA_ROOT !== '/data') fail()
}

async function main() {
  const action = process.argv[2]
  const { values } = parseArgs({ args: process.argv.slice(3), options: {
    'env-file': { type: 'string' }, project: { type: 'string' }, output: { type: 'string' }, backup: { type: 'string' },
  } })
  if (!['create', 'verify', 'restore'].includes(action)) throw new Error('Usage: node deploy/backup.mjs create|verify|restore --env-file <path> [--project <name>] [--output <new directory>] [--backup <directory>]')
  const result = action === 'create' ? await createBackup(values) : await restoreBackup(values, action === 'restore')
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Backup operation failed.')
  process.exitCode = 1
})
