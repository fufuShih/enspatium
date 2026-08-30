import fastifyEnv from '@fastify/env'
import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { fileURLToPath } from 'node:url'

const configSchema = Type.Object({
  NODE_ENV: Type.Union(
    [
      Type.Literal('development'),
      Type.Literal('test'),
      Type.Literal('production'),
    ],
    { default: 'development' },
  ),
  HOST: Type.String({ default: '127.0.0.1' }),
  PORT: Type.Integer({ default: 3000, minimum: 1, maximum: 65_535 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  SESSION_KEY: Type.String({
    minLength: 64,
    maxLength: 64,
    pattern: '^[0-9a-fA-F]{64}$',
  }),
  SESSION_SECURE: Type.Boolean({ default: false }),
})

export type AppConfig = Static<typeof configSchema>

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
  }
}

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url))

const configPluginCallback: FastifyPluginAsync = async (app) => {
  await app.register(fastifyEnv, {
    schema: configSchema,
    dotenv: { path: envPath },
  })
}

export const configPlugin = fastifyPlugin(configPluginCallback, {
  name: 'config',
})
