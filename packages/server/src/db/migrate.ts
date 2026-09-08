import { createDb } from './index.js'
import { migrateDatabase } from './migrations.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const db = createDb(databaseUrl)

try {
  const { error, results } = await migrateDatabase(db)

  for (const result of results ?? []) {
    console.log(`${result.status}: ${result.migrationName}`)
  }

  if (error) {
    throw error
  }
} finally {
  await db.destroy()
}
