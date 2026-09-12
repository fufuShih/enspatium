import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Readable } from 'node:stream'

type GitContent = {
  file: { name: string; commitId: string; size?: number }
  createReadStream: () => Readable
}

export function sendGitContent(request: FastifyRequest, reply: FastifyReply,
  content: GitContent, download: boolean, contentType?: 'application/zip') {
  const { file } = content
  const filename = encodeURIComponent(file.name).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
  const fallback = file.name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  reply.header('content-type', contentType ?? (download ? 'application/octet-stream' : 'text/plain; charset=utf-8'))
    .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${filename}`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('x-git-commit', file.commitId)
  if (file.size !== undefined) reply.header('content-length', file.size)
  if (request.method === 'HEAD') return reply.send()
  const stream = content.createReadStream()
  const cancel = () => { stream.destroy() }
  reply.raw.once('close', cancel)
  stream.once('close', () => reply.raw.off('close', cancel))
  if (reply.raw.destroyed) stream.destroy()
  return reply.send(stream)
}
