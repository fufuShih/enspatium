import Fastify from 'fastify'
import { writeFile } from 'node:fs/promises'

import { registerOpenApi } from '../openapi.js'
import { registerRoutes } from '../routes/index.js'

// Only register schemas and handlers: no listener, environment, database, or storage.
const app = Fastify()
try {
  await registerOpenApi(app)
  await registerRoutes(app)
  await app.ready()
  await writeFile(new URL('../../openapi.json', import.meta.url), `${JSON.stringify(app.swagger(), null, 2)}\n`)
  console.log('Generated packages/server/openapi.json')
} finally {
  await app.close()
}
