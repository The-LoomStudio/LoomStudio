const idAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Namespace labels remain useful to injected factories; they are not part of identity. */
export function createId(_namespace = 'id', isTaken?: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    let id = ''
    while (id.length < 11) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      for (const byte of bytes) {
        // Reject the uneven tail instead of biasing the alphabet with modulo 256.
        if (byte < 248) id += idAlphabet[byte % 62]
        if (id.length === 11) break
      }
    }
    if (!isTaken?.(id)) return id
  }
  throw new Error('Unable to allocate a unique ID')
}
