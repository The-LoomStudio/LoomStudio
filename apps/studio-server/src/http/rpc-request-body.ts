import type { IncomingMessage } from 'node:http'
import { StringDecoder } from 'node:string_decoder'

export const maxRpcRequestBodyBytes = 384 * 1024 * 1024

export class RpcRequestBodyTooLargeError extends Error {
  readonly code = 'rpc.request_too_large'

  constructor(maxBytes: number) {
    super(`RPC request body exceeds ${maxBytes} bytes`)
  }
}

export function readRpcRequestBody(request: IncomingMessage, signal: AbortSignal, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let body = ''
    let bytes = 0

    function cleanup() {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', fail)
      request.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }

    function fail(error: unknown) {
      request.pause()
      body = ''
      cleanup()
      reject(error)
    }

    function onData(chunk: Buffer) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        fail(new RpcRequestBodyTooLargeError(maxBytes))
        return
      }
      body += decoder.write(chunk)
    }

    function onEnd() {
      cleanup()
      resolve(body + decoder.end())
      body = ''
    }

    function onClose() {
      fail(new Error('RPC request body was interrupted'))
    }

    function onAbort() {
      fail(signal.reason)
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    if (Number(request.headers['content-length']) > maxBytes) {
      fail(new RpcRequestBodyTooLargeError(maxBytes))
      return
    }

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', fail)
    request.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
