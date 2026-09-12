import { createDb } from '../db/index.js'
import { createUser } from '../services/users.js'

// Run once on an installation with registration closed. Credentials arrive on
// stdin, never in command arguments, environment dumps, or successful output.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const db = createDb(databaseUrl)
try {
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
    if (Buffer.byteLength(input) > 8192) throw new Error('Input too large')
  }
  const body = JSON.parse(input) as { email: string; password: string; displayName: string }
  await createUser(db, body, { bootstrapAdmin: true })
  console.log('Administrator created. Sign in with the supplied credentials.')
} catch {
  console.error('Administrator setup failed. Check the input, database migrations, and whether an administrator already exists. No existing account was promoted.')
  process.exitCode = 1
} finally { await db.destroy() }
