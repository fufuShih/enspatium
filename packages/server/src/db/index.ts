import type { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

import type { AuditEventTable } from './audit.types.js'
import type {
  NamespaceMemberTable,
  NamespaceTable,
} from './namespace.types.js'
import type { SpaceObjectTable } from './object.types.js'
import type { SpaceMemberTable, SpaceTable } from './space.types.js'
import type { PersonalAccessTokenTable } from './token.types.js'
import type { UserTable } from './user.types.js'

export interface Database {
  users: UserTable
  namespaces: NamespaceTable
  namespace_members: NamespaceMemberTable
  spaces: SpaceTable
  space_members: SpaceMemberTable
  personal_access_tokens: PersonalAccessTokenTable
  audit_events: AuditEventTable
  space_objects: SpaceObjectTable
}

export function createDb(databaseUrl: string) {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 10,
      }),
    }),
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>
  }
}

const dbPluginCallback: FastifyPluginAsync = async (app) => {
  const db = createDb(app.config.DATABASE_URL)

  app.decorate('db', db)

  app.addHook('onClose', async () => {
    await db.destroy()
  })
}

export const dbPlugin = fastifyPlugin(dbPluginCallback, {
  name: 'db',
  dependencies: ['config'],
})
