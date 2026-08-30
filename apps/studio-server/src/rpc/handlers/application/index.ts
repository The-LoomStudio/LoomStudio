import type {
  ApplicationRuntime,
  RuntimeRequestContext,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { handleCardsRpc } from './cards.js'
import { handlePortablePayloadsRpc } from './portable-payloads.js'
import { handleStatesRpc } from './states.js'
import { handleTextTransformsRpc } from './text-transforms.js'
import { handleExtensionRecordsRpc } from './extension-records.js'
import { handleProvidersRpc } from './providers.js'
import { handleAgentsRpc } from './agents.js'
import { handleWorkspacesRpc } from './workspaces.js'
import { handleTimelineRpc } from './timeline.js'

export async function callApplicationRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue> {
  const cardsResult = await handleCardsRpc(runtime, method, params, context)
  if (cardsResult !== undefined) return cardsResult

  const portablePayloadsResult = await handlePortablePayloadsRpc(runtime, method, params, context)
  if (portablePayloadsResult !== undefined) return portablePayloadsResult

  const statesResult = await handleStatesRpc(runtime, method, params, context)
  if (statesResult !== undefined) return statesResult

  const textTransformsResult = await handleTextTransformsRpc(runtime, method, params, context)
  if (textTransformsResult !== undefined) return textTransformsResult

  const extensionRecordsResult = await handleExtensionRecordsRpc(runtime, method, params, context)
  if (extensionRecordsResult !== undefined) return extensionRecordsResult

  const providersResult = await handleProvidersRpc(runtime, method, params, context)
  if (providersResult !== undefined) return providersResult

  const agentsResult = await handleAgentsRpc(runtime, method, params, context)
  if (agentsResult !== undefined) return agentsResult

  const workspacesResult = await handleWorkspacesRpc(runtime, method, params, context)
  if (workspacesResult !== undefined) return workspacesResult

  const timelineResult = await handleTimelineRpc(runtime, method, params, context)
  if (timelineResult !== undefined) return timelineResult

  throw new Error(`Application RPC method not found: ${method}`)
}
