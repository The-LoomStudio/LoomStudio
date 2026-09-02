import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

const defaultLimit = 8
const maximumLimit = 20
const snippetLength = 240

export const officialSearchContextTool: ToolDefinition = {
  id: 'official/search_context',
  owner: { namespace: 'official' },
  name: 'search_context',
  description: 'Search context resources accessible to the current Agent turn, including items not injected because their Activation did not trigger. Returns item IDs, prompt state, and snippets for read_context.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: maximumLimit },
      },
      required: ['query'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: {
    parameterDescriptions: {
      query: 'Case-insensitive text to find in accessible context resources.',
      limit: `Maximum matches to return, from 1 to ${maximumLimit}.`,
    },
    provider: { order: 10 },
  },
}

export const officialSearchContextRegistration: ToolRuntimeRegistration = {
  toolId: officialSearchContextTool.id,
  execute: ({ invocation, scope }) => {
    const query = String(invocation.arguments?.query ?? '').trim().toLocaleLowerCase()
    const requestedLimit = invocation.arguments?.limit
    const limit = typeof requestedLimit === 'number' ? requestedLimit : defaultLimit
    const matches = (scope?.context ?? [])
      .filter(item => item.content.toLocaleLowerCase().includes(query) || item.virtualPath.toLocaleLowerCase().includes(query))
      .slice(0, limit)
      .map(item => ({
        id: item.id,
        name: item.name,
        virtualPath: item.virtualPath,
        mediaType: item.mediaType,
        sourceKind: item.sourceKind,
        promptState: item.promptState,
        snippet: readSnippet(item.content, query),
      }))
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{ type: 'json', value: { query, matches } }],
    }
  },
}

function readSnippet(content: string, query: string): string {
  const matchIndex = content.toLocaleLowerCase().indexOf(query)
  const start = Math.max(0, matchIndex - Math.floor((snippetLength - query.length) / 2))
  const snippet = content.slice(start, start + snippetLength).trim()
  return `${start > 0 ? '…' : ''}${snippet}${start + snippet.length < content.length ? '…' : ''}`
}
