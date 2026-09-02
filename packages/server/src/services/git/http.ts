import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http'
import {
  Transform,
  type TransformCallback,
} from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { resolveDataRoot } from '../space/storage.js'

const gitHttpTimeoutMilliseconds = 5 * 60 * 1000
const maxCgiHeaderBytes = 32 * 1024
const maxGitErrorBytes = 64 * 1024

export type GitHttpService = 'git-upload-pack' | 'git-receive-pack'
export type GitHttpServicePath = 'info/refs' | GitHttpService

export interface GitHttpBackendInput {
  request: IncomingMessage
  response: ServerResponse
  dataRoot: string
  spaceId: string
  service: GitHttpService
  servicePath: GitHttpServicePath
  remoteUser?: string
}

export async function serveGitHttpBackend(
  input: GitHttpBackendInput,
): Promise<void> {
  if (input.servicePath !== 'info/refs' && input.servicePath !== input.service) {
    throw new Error('Git HTTP service path does not match the service')
  }

  const environment = createGitHttpEnvironment(input)
  const child = spawn('git', ['http-backend'], {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const errorOutput: Buffer[] = []
  let errorOutputSize = 0
  let timedOut = false

  child.stderr.on('data', (chunk: Buffer) => {
    if (errorOutputSize >= maxGitErrorBytes) {
      return
    }

    const remainingBytes = maxGitErrorBytes - errorOutputSize
    const capturedChunk = chunk.subarray(0, remainingBytes)

    errorOutput.push(capturedChunk)
    errorOutputSize += capturedChunk.length
  })

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, gitHttpTimeoutMilliseconds)

  const responseTransform = new GitCgiResponseTransform(
    (statusCode, headers) => {
      input.response.writeHead(statusCode, headers)
    },
  )

  try {
    await Promise.all([
      pipeline(input.request, child.stdin),
      pipeline(child.stdout, responseTransform, input.response),
      waitForGitProcess(child),
    ])
  } catch (error) {
    child.kill()

    const stderr = Buffer.concat(errorOutput).toString('utf8').trim()
    const detail = timedOut
      ? 'Git HTTP backend timed out'
      : stderr || 'Git HTTP backend failed'

    throw new Error(detail, { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}

function createGitHttpEnvironment(
  input: GitHttpBackendInput,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GATEWAY_INTERFACE: 'CGI/1.1',
    GIT_HTTP_EXPORT_ALL: '1',
    GIT_HTTP_MAX_REQUEST_BUFFER: '10M',
    GIT_PROJECT_ROOT: resolveDataRoot(input.dataRoot),
    PATH_INFO: '/' + input.spaceId + '/' + input.servicePath,
    QUERY_STRING:
      input.servicePath === 'info/refs'
        ? 'service=' + input.service
        : '',
    REMOTE_ADDR: input.request.socket.remoteAddress ?? '',
    REQUEST_METHOD: input.request.method ?? 'GET',
    SERVER_PROTOCOL: 'HTTP/' + input.request.httpVersion,
    SERVER_SOFTWARE: 'Enspatium',
  }

  setEnvironmentHeader(
    environment,
    'CONTENT_LENGTH',
    input.request.headers['content-length'],
  )
  setEnvironmentHeader(
    environment,
    'CONTENT_TYPE',
    input.request.headers['content-type'],
  )
  setEnvironmentHeader(
    environment,
    'HTTP_GIT_PROTOCOL',
    input.request.headers['git-protocol'],
  )

  if (input.remoteUser) {
    environment.REMOTE_USER = input.remoteUser
  }

  return environment
}

function setEnvironmentHeader(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: string | string[] | undefined,
): void {
  const header = Array.isArray(value) ? value[0] : value

  if (header !== undefined) {
    environment[name] = header
  }
}

function waitForGitProcess(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(
        new Error(
          signal
            ? 'Git HTTP backend terminated with signal ' + signal
            : 'Git HTTP backend exited with code ' + String(code),
        ),
      )
    })
  })
}

class GitCgiResponseTransform extends Transform {
  private headerBuffer = Buffer.alloc(0)
  private headersParsed = false

  constructor(
    private readonly onHeaders: (
      statusCode: number,
      headers: OutgoingHttpHeaders,
    ) => void,
  ) {
    super()
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (this.headersParsed) {
      callback(null, chunk)
      return
    }

    this.headerBuffer = Buffer.concat([this.headerBuffer, chunk])
    const headerEnd = findCgiHeaderEnd(this.headerBuffer)

    if (!headerEnd) {
      if (this.headerBuffer.length > maxCgiHeaderBytes) {
        callback(new Error('Git HTTP backend returned oversized CGI headers'))
        return
      }

      callback()
      return
    }

    if (headerEnd.index > maxCgiHeaderBytes) {
      callback(new Error('Git HTTP backend returned oversized CGI headers'))
      return
    }

    try {
      const headerText = this.headerBuffer
        .subarray(0, headerEnd.index)
        .toString('latin1')
      const body = this.headerBuffer.subarray(
        headerEnd.index + headerEnd.length,
      )
      const { statusCode, headers } = parseCgiHeaders(headerText)

      this.headersParsed = true
      this.headerBuffer = Buffer.alloc(0)
      this.onHeaders(statusCode, headers)
      callback(null, body)
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  override _flush(callback: TransformCallback): void {
    if (!this.headersParsed) {
      callback(new Error('Git HTTP backend returned no CGI headers'))
      return
    }

    callback()
  }
}

function findCgiHeaderEnd(
  buffer: Buffer,
): { index: number; length: number } | undefined {
  const carriageReturnIndex = buffer.indexOf('\r\n\r\n')

  if (carriageReturnIndex >= 0) {
    return { index: carriageReturnIndex, length: 4 }
  }

  const newlineIndex = buffer.indexOf('\n\n')

  return newlineIndex >= 0
    ? { index: newlineIndex, length: 2 }
    : undefined
}

function parseCgiHeaders(headerText: string): {
  statusCode: number
  headers: OutgoingHttpHeaders
} {
  let statusCode = 200
  const headers: OutgoingHttpHeaders = {}

  for (const line of headerText.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':')

    if (separatorIndex <= 0) {
      throw new Error('Git HTTP backend returned invalid CGI headers')
    }

    const name = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()

    if (name.toLowerCase() === 'status') {
      const parsedStatusCode = Number.parseInt(value.slice(0, 3), 10)

      if (parsedStatusCode < 100 || parsedStatusCode > 599) {
        throw new Error('Git HTTP backend returned an invalid status')
      }

      statusCode = parsedStatusCode
      continue
    }

    const lowerName = name.toLowerCase()

    if (lowerName === 'connection' || lowerName === 'transfer-encoding') {
      continue
    }

    const previousValue = headers[lowerName]

    if (previousValue === undefined) {
      headers[lowerName] = value
    } else if (Array.isArray(previousValue)) {
      previousValue.push(value)
    } else {
      headers[lowerName] = [String(previousValue), value]
    }
  }

  return { statusCode, headers }
}
