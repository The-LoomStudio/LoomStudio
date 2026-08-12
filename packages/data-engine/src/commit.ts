export type DataActorRef = {
  kind: 'kernel' | 'client' | 'extension' | 'workspace-adapter' | 'system'
  id: string
}

export type DataCommitOperation = {
  store: string
  kind: 'create' | 'update' | 'delete' | 'restore'
  entityId: string
  entityType: string
  fromVersion?: number
  toVersion?: number
}

export type DataCommitFact = {
  changesetId: string
  createdAt: string
  committedAt: string
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  operations: DataCommitOperation[]
}

export type DataCommitObserver<TFact extends DataCommitFact = DataCommitFact> = (commit: TFact) => void

export type DataCommitSubscription = {
  dispose(): void
}

export type DataCommitSource<TFact extends DataCommitFact = DataCommitFact> = {
  subscribeCommits(observer: DataCommitObserver<TFact>): DataCommitSubscription
}

export function createDataCommitNotifier<TFact extends DataCommitFact>(): {
  notify(commit: TFact): void
  subscribe(observer: DataCommitObserver<TFact>): DataCommitSubscription
} {
  const observers = new Set<DataCommitObserver<TFact>>()

  return {
    notify: commit => {
      for (const observer of observers) {
        try {
          observer(structuredClone(commit) as TFact)
        } catch {
          // ponytail: Post-commit observer failures cannot roll back persisted data; route them to Diagnostics when observers gain a reporter.
        }
      }
    },
    subscribe: observer => {
      observers.add(observer)
      return { dispose: () => observers.delete(observer) }
    },
  }
}
