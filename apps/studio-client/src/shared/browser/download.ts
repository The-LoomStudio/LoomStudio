export async function readBoundedResponseBlob(response: Response, maxBytes: number, tooLargeMessage: string): Promise<Blob> {
  const tooLarge = new Error(tooLargeMessage)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    // A cleanup failure must not replace the size-limit error.
    await response.body?.cancel(tooLarge).catch(() => undefined)
    throw tooLarge
  }

  const type = response.headers.get('content-type') ?? ''
  if (!response.body) return new Blob([], { type })
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel(tooLarge).catch(() => undefined)
        throw tooLarge
      }
      chunks.push(value)
    }
    // ponytail: This bounds accumulated bytes, not browser network buffers or Blob allocation overhead.
    return new Blob(chunks, { type })
  } finally {
    reader.releaseLock()
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export function downloadBase64(base64: string, fileName: string, mediaType: string): void {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  downloadBlob(new Blob([bytes], { type: mediaType }), fileName)
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}
