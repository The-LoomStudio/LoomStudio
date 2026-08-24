export { createPromptToolExecutionScope } from './context-snapshot.js'
export { officialReadContextTool } from './read-context.js'
export { officialSearchContextTool } from './search-context.js'

import { createAgentToolRegistry } from '../tool-registry.js'
import { officialReadContextRegistration, officialReadContextTool } from './read-context.js'
import { officialSearchContextRegistration, officialSearchContextTool } from './search-context.js'

export const officialAgentToolDefinitions = [
  officialSearchContextTool,
  officialReadContextTool,
] as const

export function createOfficialAgentToolRegistry() {
  return createAgentToolRegistry(
    officialAgentToolDefinitions,
    [officialSearchContextRegistration, officialReadContextRegistration],
  )
}
