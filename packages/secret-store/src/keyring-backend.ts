import type { SecretBackend, SecretPlaintext } from './types.js'

const defaultService = 'loom-studio.secrets.v1'

export class KeyringSecretBackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'KeyringSecretBackendError'
  }
}

export function createKeyringSecretBackend(options: { service?: string } = {}): SecretBackend {
  const service = normalizeService(options.service)

  return {
    write: async (key, plaintext) => {
      const entry = await createEntry(service, key)
      try {
        await entry.setSecret(encodePlaintext(plaintext))
      } catch {
        throw new KeyringSecretBackendError('secret.keyring_write_failed', 'System credential store write failed')
      }
    },
    read: async key => {
      const entry = await createEntry(service, key)
      let encoded: Uint8Array | number[] | undefined | null
      try {
        encoded = await entry.getSecret() as Uint8Array | number[] | undefined | null
      } catch {
        throw new KeyringSecretBackendError('secret.keyring_read_failed', 'System credential store read failed')
      }
      return encoded ? decodePlaintext(encoded) : undefined
    },
    delete: async key => {
      const entry = await createEntry(service, key)
      try {
        await entry.deleteCredential()
      } catch {
        throw new KeyringSecretBackendError('secret.keyring_delete_failed', 'System credential store delete failed')
      }
    },
  }
}

async function createEntry(service: string, key: string) {
  assertBackendKey(key)
  try {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return new AsyncEntry(service, key)
  } catch {
    throw new KeyringSecretBackendError('secret.keyring_unavailable', 'System credential store is unavailable')
  }
}

function encodePlaintext(plaintext: SecretPlaintext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ values: plaintext.values }))
}

function decodePlaintext(encoded: Uint8Array | number[]): SecretPlaintext {
  if (Array.isArray(encoded) && encoded.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new KeyringSecretBackendError('secret.keyring_value_invalid', 'System credential store value is invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(encoded)))
  } catch {
    throw new KeyringSecretBackendError('secret.keyring_value_invalid', 'System credential store value is invalid')
  }
  if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) {
    throw new KeyringSecretBackendError('secret.keyring_value_invalid', 'System credential store value is invalid')
  }
  const values = Reflect.get(parsed, 'values')
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new KeyringSecretBackendError('secret.keyring_value_invalid', 'System credential store value is invalid')
  }
  const entries = Object.entries(values)
  if (entries.length === 0 || entries.some(([key, value]) => !key || typeof value !== 'string')) {
    throw new KeyringSecretBackendError('secret.keyring_value_invalid', 'System credential store value is invalid')
  }
  return Object.freeze({ values: Object.freeze(Object.fromEntries(entries) as Record<string, string>) })
}

function normalizeService(service: string | undefined): string {
  const normalized = service?.trim() || defaultService
  if (normalized.length > 128 || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new KeyringSecretBackendError('secret.keyring_service_invalid', 'System credential store service name is invalid')
  }
  return normalized
}

function assertBackendKey(key: string): void {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(key)) {
    throw new KeyringSecretBackendError('secret.keyring_key_invalid', 'System credential store key is invalid')
  }
}
