import type { JsonObject } from '@loom-studio/shared'
import { z } from 'zod'
import type { AiProviderKind } from './types.js'

const openAIOptions = z.strictObject({
  store: z.boolean().optional(),
  user: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  serviceTier: z.enum(['auto', 'default', 'flex', 'priority']).optional(),
  reasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
  promptCacheKey: z.string().optional(),
})
const anthropicOptions = z.strictObject({
  thinking: z
    .discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('enabled'),
        budgetTokens: z.number().int().positive(),
      }),
      z.strictObject({ type: z.literal('disabled') }),
    ])
    .optional(),
})
const googleOptions = z.strictObject({
  thinkingConfig: z
    .strictObject({
      thinkingBudget: z.number().int().nonnegative().optional(),
      includeThoughts: z.boolean().optional(),
    })
    .optional(),
})
const compatibleOptions = z.strictObject({})

export function parseProviderOptions(
  kind: AiProviderKind,
  input: JsonObject | undefined,
): Record<string, JsonObject> | undefined {
  if (!input) return undefined
  const parsed =
    kind === 'openai'
      ? openAIOptions.parse(input)
      : kind === 'anthropic'
        ? anthropicOptions.parse(input)
        : kind === 'google'
          ? googleOptions.parse(input)
          : compatibleOptions.parse(input)
  return { [kind]: parsed as JsonObject }
}
