import type { StudioRpcInputs, StudioRpcOutputs } from '../shared/api/trpc-client.js'

export type ObservationListInput = Exclude<StudioRpcInputs['application']['observations.list'], void | undefined>
export type ObservationListResult = StudioRpcOutputs['application']['observations.list']
export type ObservationSummary = ObservationListResult['records'][number]
export type ObservationDetail = NonNullable<StudioRpcOutputs['application']['observations.get']>
export type ObservationEntry = NonNullable<StudioRpcOutputs['application']['observations.getRequest']>
