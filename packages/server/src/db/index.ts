import type { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

export interface Database {}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>
  }
}

const dbPluginCallback: FastifyPluginAsync = async (app) => {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: app.config.DATABASE_URL,
        max: 10,
      }),
    }),
  })

  app.decorate('db', db)

  app.addHook('onClose', async () => {
    await db.destroy()
  })
}

export const dbPlugin = fastifyPlugin(dbPluginCallback, {
  name: 'db',
  dependencies: ['config'],
})
