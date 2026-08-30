import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'kysely'
import {
  Migrator,
  type Migration,
  type MigrationProvider,
} from 'kysely/migration'

import { createDb } from './index.js'

class SqlMigrationProvider implements MigrationProvider {
  constructor(private readonly folder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.folder))
      .filter((file) => extname(file) === '.sql')
      .sort()

    const migrations: Record<string, Migration> = {}

    for (const file of files) {
      const name = basename(file, '.sql')
      const contents = await readFile(join(this.folder, file), 'utf8')

      migrations[name] = {
        up: async (db) => {
          await sql.raw(contents).execute(db)
        },
      }
    }

    return migrations
  }
}

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const migrationFolder = fileURLToPath(
  new URL('./migrations/', import.meta.url),
)

const db = createDb(databaseUrl)

try {
  const migrator = new Migrator({
    db,
    provider: new SqlMigrationProvider(migrationFolder),
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    console.log(`${result.status}: ${result.migrationName}`)
  }

  if (error) {
    throw error
  }
} finally {
  await db.destroy()
}