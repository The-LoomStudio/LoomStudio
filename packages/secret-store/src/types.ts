import type { DataActorRef, DataCommitFact } from '@loom-studio/data-engine'

export type SecretRef = `secret:${string}`

export type SecretOwner = {
  type: string
  id: string
}

export type SecretPlaintext = Readonly<{
  values: Readonly<Record<string, string>>
}>

export type SecretMetadata = {
  ref: SecretRef
  owner: SecretOwner
  purpose: string
  label?: string
  state: 'active' | 'pending-delete'
  createdAt: string
  updatedAt: string
}

export type SecretWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type SecretUseContext = {
  caller: string
  owner: SecretOwner
  purpose: string
}

export type SecretBackend = {
  write(key: string, plaintext: SecretPlaintext): Promise<void>
  read(key: string): Promise<SecretPlaintext | undefined>
  delete(key: string): Promise<void>
}

export type SecretStore = {
  create(input: SecretWriteContext & {
    owner: SecretOwner
    purpose: string
    label?: string
    plaintext: SecretPlaintext
  }): Promise<{ metadata: SecretMetadata; commit: DataCommitFact }>
  replace(input: SecretWriteContext & {
    ref: SecretRef
    owner: SecretOwner
    plaintext: SecretPlaintext
  }): Promise<{ metadata: SecretMetadata; cleanupPending: boolean; commit: DataCommitFact }>
  getMetadata(ref: SecretRef): Promise<SecretMetadata | undefined>
  delete(input: SecretWriteContext & {
    ref: SecretRef
    owner: SecretOwner
  }): Promise<{ deleted: boolean; cleanupPending: boolean; commit: DataCommitFact }>
  withSecret<T>(ref: SecretRef, context: SecretUseContext, operation: (plaintext: SecretPlaintext) => Promise<T>): Promise<T>
  retryPendingCleanup(context: SecretWriteContext): Promise<number>
}
