import type { SecretBackend, SecretPlaintext } from './types.js'

export function createMemorySecretBackend(): SecretBackend {
  const values = new Map<string, SecretPlaintext>()

  return {
    write: async (key, plaintext) => {
      values.set(key, clonePlaintext(plaintext))
    },
    read: async key => {
      const plaintext = values.get(key)
      return plaintext ? clonePlaintext(plaintext) : undefined
    },
    delete: async key => {
      values.delete(key)
    },
  }
}

function clonePlaintext(plaintext: SecretPlaintext): SecretPlaintext {
  return Object.freeze({ values: Object.freeze({ ...plaintext.values }) })
}
