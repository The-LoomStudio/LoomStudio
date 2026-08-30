import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { TimelineRuntimeContextContent } from '../types.js'

export function timelineRuntimeContextId(timelineId: string): string {
  return `timeline-runtime-context:${timelineId}`
}

export async function readTimelineRuntimeContext(
  ctx: ApplicationRuntimeContext,
  timelineId: string,
): Promise<TimelineRuntimeContextContent | undefined> {
  const document = await ctx.documents.get(timelineRuntimeContextId(timelineId))
  if (!document || document.type !== applicationDocumentTypes.timelineRuntimeContext) return undefined
  return structuredClone(document.content) as TimelineRuntimeContextContent
}
