import {
  createVariableRenderContext,
  renderVariableMacros,
  type VariableSnapshot,
} from '@loom-studio/shared/macros'
import type { JsonObject } from '@loom-studio/shared'

export type MacroRenderContext = {
  snapshot?: VariableSnapshot
  global?: JsonObject
  timeline?: JsonObject
  card?: { name?: string; userName?: string; description?: string }
  fallbackUserName?: string
}

export function renderTemplateMacros(template: string, context?: MacroRenderContext): string {
  if (!template.includes('{{')) return template
  if (context?.snapshot) {
    return renderVariableMacros(template, {
      snapshot: context.snapshot,
      trace: { reads: [], diagnostics: [] },
    })
  }
  const global = structuredClone(context?.global ?? {})
  const user = global.user
  const userObject = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
  if (typeof userObject.name !== 'string' || userObject.name.trim().length === 0) {
    global.user = { ...userObject, name: context?.fallbackUserName?.trim() || context?.card?.userName?.trim() || 'User' }
  }
  const computed: JsonObject = {}
  if (context?.card?.name) {
    computed.char = { name: context.card.name, ...(context.card.description !== undefined ? { description: context.card.description } : {}) }
    computed.bot = { name: context.card.name }
  }
  return renderVariableMacros(template, createVariableRenderContext({
    global,
    timeline: context?.timeline,
    computed,
  }))
}
