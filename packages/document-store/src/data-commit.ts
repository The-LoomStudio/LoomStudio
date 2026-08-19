import type { DataCommitSource } from '@loom-studio/data-engine'
import type { DocumentStore } from './types.js'

export function createDocumentDataCommitSource(
  documents: Pick<DocumentStore, 'subscribeCommits'>,
): DataCommitSource {
  return {
    subscribeCommits: observer => documents.subscribeCommits(observer),
  }
}
