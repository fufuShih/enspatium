import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { requireCurrentUserId } from './current-user.route.js'
import { CreateUserBodySchema } from './types/users.types.js'
import { createUser } from '../services/users.js'
import { adminUser, listAdminUsers, requireSiteAdmin, setUserDisabled } from '../services/admin-users.js'

const AdminUserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), email: Type.String(), displayName: Type.String(),
  isAdmin: Type.Boolean(), isDisabled: Type.Boolean(), createdAt: Type.String(),
})

export const adminUserRoutes: FastifyPluginAsyncTypebox = async app => {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    await requireSiteAdmin(app.db, requireCurrentUserId(request))
  })
  app.get('/admin/users', {
    schema: { operationId: 'listAdminUsers', tags: ['admin'], querystring: Type.Object({ search: Type.Optional(Type.String({ maxLength: 100 })), cursor: Type.Optional(Type.String({ format: 'uuid' })) }),
      response: { 200: Type.Object({ users: Type.Array(AdminUserSchema), nextCursor: Type.Union([Type.String(), Type.Null()]) }) } },
  }, async request => listAdminUsers(app.db, requireCurrentUserId(request), request.query.search, request.query.cursor))

  app.post('/admin/users', {
    schema: { operationId: 'createAdminManagedUser', tags: ['admin'], body: CreateUserBodySchema, response: { 201: AdminUserSchema } },
  }, async (request, reply) => {
    const actor = requireCurrentUserId(request)
    const user = await createUser(app.db, request.body, { actorId: actor })
    return reply.code(201).send(adminUser(await app.db.selectFrom('users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow()))
  })

  app.patch('/admin/users/:userId', {
    schema: { operationId: 'setUserAccess', tags: ['admin'], params: Type.Object({ userId: Type.String({ format: 'uuid' }) }), body: Type.Object({ disabled: Type.Boolean() }, { additionalProperties: false }), response: { 200: AdminUserSchema } },
  }, async request => setUserDisabled(app.db, requireCurrentUserId(request), request.params.userId, request.body.disabled))
}
