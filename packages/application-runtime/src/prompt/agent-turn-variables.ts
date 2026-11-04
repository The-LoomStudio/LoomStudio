import { readPlayerProfile, type JsonObject } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { readUserProfiles, resolveCurrentUserProfile } from '../profiles/user-profiles.js'
import { createVariableRenderContext, type VariableRenderContext } from './variables.js'

export async function readAgentTurnVariables(
  ctx: Pick<ApplicationRuntimeContext, 'now' | 'states' | 'documents'>,
  timeline?: JsonObject,
  characterName?: string,
  requirePlayerProfile = false,
): Promise<VariableRenderContext> {
  const globalSnapshot = await ctx.states.getGlobalSnapshot()
  const global = structuredClone(globalSnapshot?.revision.snapshot ?? {}) as JsonObject
  // ponytail: Legacy Timelines keep global profiles until an explicit history/branch migration is defined.
  const user = requirePlayerProfile ? readPlayerProfile(timeline!)
    : resolveCurrentUserProfile(await readUserProfiles(ctx.documents))
  return createVariableRenderContext({
    global,
    ...(timeline ? { timeline } : {}),
    computed: {
      user: { name: user.name, description: user.description },
      global: {
        time: { now: ctx.now() },
      },
      ...(characterName ? {
        char: { name: characterName },
        bot: { name: characterName },
      } : {}),
    },
  })
}

