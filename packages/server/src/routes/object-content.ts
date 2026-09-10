import type { FastifyReply, FastifyRequest } from 'fastify'
import type { openObjectDownload } from '../services/object/object.js'
import { resolveObjectRange } from '../services/object/range.js'

export async function sendObjectContent(
  request: FastifyRequest, reply: FastifyReply,
  { object, file }: Awaited<ReturnType<typeof openObjectDownload>>,
) {
  let streamOwnsFile = false
  try {
    const etag = `"${object.checksumSha256}"`
    const ifRange = request.headers['if-range']
    const range = request.method === 'HEAD' ? { kind: 'full' as const }
      : resolveObjectRange(object.sizeBytes, request.headers.range, Array.isArray(ifRange) ? ifRange.join(',') : ifRange, etag)
    reply.header('accept-ranges', 'bytes')
      .header('etag', etag)
      .header('cache-control', 'private, no-store')
      .header('x-content-sha256', object.checksumSha256)
    if (range.kind === 'unsatisfiable') {
      await file.close()
      return reply.code(416).header('content-range', `bytes */${object.sizeBytes}`)
        .header('content-length', 0).send()
    }
    reply.header('content-type', object.contentType)
      .header('content-length', range.kind === 'partial' ? range.end - range.start + 1 : object.sizeBytes)
    if (request.method === 'HEAD') {
      await file.close()
      return reply.send()
    }
    if (range.kind === 'partial') {
      reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${object.sizeBytes}`)
    }
    const stream = file.createReadStream(range.kind === 'partial' ? { start: range.start, end: range.end } : undefined)
    streamOwnsFile = true
    // Also cover disconnects while authorization/open were still in progress.
    const cancel = () => { stream.destroy() }
    reply.raw.once('close', cancel)
    stream.once('close', () => reply.raw.off('close', cancel))
    if (reply.raw.destroyed) stream.destroy()
    return reply.send(stream)
  } finally {
    if (!streamOwnsFile) await file.close()
  }
}
