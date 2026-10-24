import type {
  ClientExtensionActivationContext,
  ClientStateSnapshot,
  ClientStateTarget,
  ExtensionConfigEntry,
  ExtensionRegistrationHandle,
  ExtensionStorageScope,
} from './index.js'
import type { ExtensionTimelineTarget } from './timeline.js'

/** Dedicated Worker context. Thread isolation is not a security sandbox: native network/storage remain available. */
export type WorkerExtensionActivationContext = Pick<ClientExtensionActivationContext,
  'extension' | 'signal' | 'logger' | 'notifications' | 'tokens' | 'logs' | 'records' | 'history' | 'rpc'
> & {
  timeline: { getTarget(): Promise<Readonly<ExtensionTimelineTarget> | undefined> }
  assets: { url(assetId: string): Promise<string> }
  files: { url(path: string): Promise<string> }
  configs: Pick<ClientExtensionActivationContext['configs'], 'list' | 'get' | 'upsert'> & {
    subscribe(input: { scope?: ExtensionStorageScope }, handler: (entries: ExtensionConfigEntry[]) => void | Promise<void>): Promise<ExtensionRegistrationHandle>
  }
  state: {
    get(target: ClientStateTarget): Promise<ClientStateSnapshot>
    subscribe(target: ClientStateTarget, handler: (snapshot: ClientStateSnapshot) => void | Promise<void>, onError?: (error: Error) => void): Promise<ExtensionRegistrationHandle>
  }
}

export type WorkerExtensionModule = {
  activate(context: WorkerExtensionActivationContext): void | ExtensionRegistrationHandle | Promise<void | ExtensionRegistrationHandle>
}
