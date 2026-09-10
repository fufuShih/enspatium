import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql, type Kysely } from 'kysely'
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration'
import type { Database } from './index.js'

class SqlMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const folder = fileURLToPath(new URL('./migrations/', import.meta.url))
    const files = (await readdir(folder)).filter(file => extname(file) === '.sql').sort()
    const migrations: Record<string, Migration> = {}
    for (const file of files) {
      const contents = await readFile(join(folder, file), 'utf8')
      migrations[basename(file, '.sql')] = { up: async db => { await sql.raw(contents).execute(db) } }
    }
    return migrations
  }
}

export function migrateDatabase(db: Kysely<Database>, migrationTableSchema?: string, target?: string) {
  const migrator = new Migrator({
    db,
    provider: new SqlMigrationProvider(),
    ...(migrationTableSchema ? { migrationTableSchema } : {}),
  })
  return target ? migrator.migrateTo(target) : migrator.migrateToLatest()
}
