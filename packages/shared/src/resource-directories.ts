export type CardDirectoryPreview = {
  cardId: string
  directory: string
  token: string
  changes: Array<{ path: string; kind: 'added' | 'modified' | 'deleted' }>
  conflicts: string[]
}

export type CardDirectorySaveResult = {
  directory: string
  changedFiles: number
}

export type CardDirectoryEntry = {
  directory: string
  name: string
  artifactId?: string
  sourceCardId?: string
  registeredCardId?: string
  sameSourceCount: number
  error?: string
}

export type CardDirectoryCatalog = {
  root: string
  entries: CardDirectoryEntry[]
  error?: string
}

export type OpenCardDirectoryResult = {
  token: string
  directory: string
  name: string
  artifactId: string
  description?: string
  files: Array<{ path: string; sizeBytes: number }>
  totalBytes: number
  attachments?: Array<{ path: string; kind: 'image' | 'document'; label: string; sizeBytes: number }>
  promptResources: Array<{ id: string; label: string; external: boolean; indexPath?: string }>
  scriptCount: number
  payloadCount: number
}

export type CardDirectoryAttachment = { kind: 'image' | 'document'; content: string }
