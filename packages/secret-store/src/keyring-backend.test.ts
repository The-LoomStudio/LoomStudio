import { describe, expect, it } from 'vitest'
import { KeyringSecretBackendError, createKeyringSecretBackend } from './keyring-backend.js'

describe('Keyring Secret Backend', () => {
  it('rejects invalid service names and backend keys before native access', async () => {
    expect(() => createKeyringSecretBackend({ service: 'invalid service' })).toThrowError(KeyringSecretBackendError)
    const backend = createKeyringSecretBackend()
    await expect(backend.read('../invalid')).rejects.toMatchObject({ code: 'secret.keyring_key_invalid' })
  })
})
