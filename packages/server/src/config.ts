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
  DATA_ROOT: Type.String({ minLength: 1, default: './data' }),
  OBJECT_CLEANUP_INTERVAL_SECONDS: Type.Integer({ default: 3600, minimum: 60, maximum: 86400 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  SESSION_KEY: Type.String({
    minLength: 64,
    maxLength: 64,
    pattern: '^[0-9a-fA-F]{64}$',
  }),
  SESSION_SECURE: Type.Boolean({ default: false }),
  REGISTRATION_ENABLED: Type.Optional(Type.Boolean()),
  TRUST_PROXY: Type.Boolean({ default: false }),
  LOGIN_RATE_LIMIT: Type.Integer({ default: 20, minimum: 1, maximum: 10000 }),
  LOGIN_ACCOUNT_RATE_LIMIT: Type.Integer({ default: 10, minimum: 1, maximum: 10000 }),
  REGISTRATION_RATE_LIMIT: Type.Integer({ default: 5, minimum: 1, maximum: 10000 }),
  GIT_AUTH_RATE_LIMIT: Type.Integer({ default: 300, minimum: 1, maximum: 10000 }),
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
  validateProductionConfig(app.config)
  app.config.REGISTRATION_ENABLED ??= app.config.NODE_ENV !== 'production'
}

export function validateProductionConfig(config: Pick<AppConfig, 'NODE_ENV' | 'SESSION_SECURE' | 'SESSION_KEY'>) {
  if (config.NODE_ENV !== 'production') return
  if (!config.SESSION_SECURE) throw new Error('Production requires SESSION_SECURE=true and HTTPS.')
  if (config.SESSION_KEY === '0123456789abcdef'.repeat(4)) throw new Error('Replace the example SESSION_KEY before running in production.')
}

export const configPlugin = fastifyPlugin(configPluginCallback, {
  name: 'config',
})
