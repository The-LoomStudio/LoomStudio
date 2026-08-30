import type {
  ApplicationRuntime,
  RuntimeRequestContext,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  readOptionalNumber,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleTimelineRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createNarrativeTimeline':
      return await runtime.createNarrativeTimeline({
        cardId: readString(params, 'cardId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.getNarrativeTimeline':
      return await runtime.getNarrativeTimeline({
        timelineId: readString(params, 'timelineId'),
      }) as unknown as JsonValue

    case 'application.listNarrativeTimelines':
      return await runtime.listNarrativeTimelines({
        createdFromCardId: readOptionalString(params, 'createdFromCardId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.getNarrativePage':
      return await runtime.getNarrativePage({
        timelineId: readString(params, 'timelineId'),
        branchId: readOptionalString(params, 'branchId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.forkNarrativeBranch':
      return await runtime.forkNarrativeBranch({
        timelineId: readString(params, 'timelineId'),
        fromBranchId: readString(params, 'fromBranchId'),
        fromNodeId: readString(params, 'fromNodeId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.switchNarrativeBranch':
      return await runtime.switchNarrativeBranch({
        timelineId: readString(params, 'timelineId'),
        branchId: readString(params, 'branchId'),
        expectedActiveBranchId: readOptionalString(params, 'expectedActiveBranchId'),
      }, context) as unknown as JsonValue

    case 'application.deleteNarrativeTimeline':
      return await runtime.deleteNarrativeTimeline({
        timelineId: readString(params, 'timelineId'),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}
