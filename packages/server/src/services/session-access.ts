import type { FastifyInstance } from 'fastify'

export function registerSessionAccess(app: FastifyInstance) {
  app.addHook('onRequest', async request => {
    const userId = request.session.get('userId')
    if (!userId) return
    const user = await app.db.selectFrom('users').select(['is_disabled', 'session_version']).where('id', '=', userId).executeTakeFirst()
    if (!user || user.is_disabled || user.session_version !== (request.session.get('sessionVersion') ?? 0)) {
      // Clear identity before any route can authorize this request. Public routes
      // remain public; protected routes challenge the now unauthenticated client.
      request.session.set('userId', undefined)
      request.session.set('sessionVersion', undefined)
      request.session.delete()
    }
  })
}
