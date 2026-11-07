import type { StudioTrpcClient, StudioRpcInputs, StudioRpcOutputs } from './trpc-client.js'
export type ResourceDownloadsClient = {
  previewPromptUpdate(input: StudioRpcInputs['resourceDownloads']['previewPromptUpdate']): Promise<StudioRpcOutputs['resourceDownloads']['previewPromptUpdate']>
  applyPromptUpdate(input: StudioRpcInputs['resourceDownloads']['applyPromptUpdate']): Promise<StudioRpcOutputs['resourceDownloads']['applyPromptUpdate']>

  previewCardUpdate(input: StudioRpcInputs['resourceDownloads']['previewCardUpdate']): Promise<StudioRpcOutputs['resourceDownloads']['previewCardUpdate']>
  applyCardUpdate(input: StudioRpcInputs['resourceDownloads']['applyCardUpdate']): Promise<StudioRpcOutputs['resourceDownloads']['applyCardUpdate']>

  resolve: (input: StudioRpcInputs['resourceDownloads']['resolve']) => Promise<StudioRpcOutputs['resourceDownloads']['resolve']>
  start: (input: StudioRpcInputs['resourceDownloads']['start']) => Promise<StudioRpcOutputs['resourceDownloads']['start']>
  list: () => Promise<StudioRpcOutputs['resourceDownloads']['list']>
  cancel: (id: string) => Promise<StudioRpcOutputs['resourceDownloads']['cancel']>
  retry: (id: string) => Promise<StudioRpcOutputs['resourceDownloads']['retry']>
  prepareDependencies: (id: string) => Promise<StudioRpcOutputs['resourceDownloads']['prepareDependencies']>
  listUpdates: () => Promise<StudioRpcOutputs['resourceDownloads']['listUpdates']>
  checkUpdates: (input?: { force?: boolean }) => Promise<StudioRpcOutputs['resourceDownloads']['checkUpdates']>
  updatePolicy: (input: StudioRpcInputs['resourceDownloads']['updatePolicy']) => Promise<StudioRpcOutputs['resourceDownloads']['updatePolicy']>
  ignore: (input: StudioRpcInputs['resourceDownloads']['ignore']) => Promise<StudioRpcOutputs['resourceDownloads']['ignore']>
  acknowledge: (id: string) => Promise<StudioRpcOutputs['resourceDownloads']['acknowledge']>
  previewUse: (id: string, cardId?: string) => Promise<StudioRpcOutputs['resourceDownloads']['previewUse']>
  commitUse: (id: string, token: string) => Promise<StudioRpcOutputs['resourceDownloads']['commitUse']>
}
export function createResourceDownloadsClient(trpc: StudioTrpcClient): ResourceDownloadsClient {
  return {
    previewPromptUpdate: input => trpc.resourceDownloads.previewPromptUpdate.mutate(input),
    applyPromptUpdate: input => trpc.resourceDownloads.applyPromptUpdate.mutate(input),
    previewCardUpdate: input => trpc.resourceDownloads.previewCardUpdate.mutate(input),
    applyCardUpdate: input => trpc.resourceDownloads.applyCardUpdate.mutate(input),
      resolve: (input: StudioRpcInputs['resourceDownloads']['resolve']) => trpc.resourceDownloads.resolve.mutate(input),
      start: (input: StudioRpcInputs['resourceDownloads']['start']) => trpc.resourceDownloads.start.mutate(input),
      list: () => trpc.resourceDownloads.list.query(),
      cancel: (id: string) => trpc.resourceDownloads.cancel.mutate({ id }),
      retry: (id: string) => trpc.resourceDownloads.retry.mutate({ id }),
      prepareDependencies: (id: string) => trpc.resourceDownloads.prepareDependencies.mutate({ id }),
      listUpdates: () => trpc.resourceDownloads.listUpdates.query(),
      checkUpdates: (input?: { force?: boolean }) => trpc.resourceDownloads.checkUpdates.mutate(input),
      updatePolicy: input => trpc.resourceDownloads.updatePolicy.mutate(input),
      ignore: (input: { id: string; candidateId?: string }) => trpc.resourceDownloads.ignore.mutate(input),
      acknowledge: (id: string) => trpc.resourceDownloads.acknowledge.mutate({ id }),
      previewUse: (id: string, cardId?: string) => trpc.resourceDownloads.previewUse.mutate({ id, cardId }),
      commitUse: (id: string, token: string) => trpc.resourceDownloads.commitUse.mutate({ id, token }),
    }
}
