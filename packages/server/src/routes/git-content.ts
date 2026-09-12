import type { FastifyReply, FastifyRequest } from 'fastify'
import type { openGitFile } from '../services/git/repository.js'

export function sendGitContent(request: FastifyRequest, reply: FastifyReply,
  content: Awaited<ReturnType<typeof openGitFile>>, download: boolean) {
  const { file } = content
  const filename = encodeURIComponent(file.name).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
  const fallback = file.name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  reply.header('content-type', download ? 'application/octet-stream' : 'text/plain; charset=utf-8')
    .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${filename}`)
    .header('content-length', file.size)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('x-git-commit', file.commitId)
  if (request.method === 'HEAD') return reply.send()
  const stream = content.createReadStream()
  const cancel = () => { stream.destroy() }
  reply.raw.once('close', cancel)
  stream.once('close', () => reply.raw.off('close', cancel))
  if (reply.raw.destroyed) stream.destroy()
  return reply.send(stream)
}
