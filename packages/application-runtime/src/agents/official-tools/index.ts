export { createPromptToolExecutionScope } from './context-snapshot.js'
export { officialReadContextTool } from './read-context.js'
export { officialSearchContextTool } from './search-context.js'
export { officialReadStateTool } from './read-state.js'
export { officialUpdateStateTool } from './update-state.js'

import { createAgentToolRegistry } from '../tool-registry.js'
import { officialReadContextRegistration, officialReadContextTool } from './read-context.js'
import { officialSearchContextRegistration, officialSearchContextTool } from './search-context.js'
import { officialReadStateRegistration, officialReadStateTool } from './read-state.js'
import { officialUpdateStateRegistration, officialUpdateStateTool } from './update-state.js'

export const officialAgentToolDefinitions = [
  officialSearchContextTool,
  officialReadContextTool,
  officialReadStateTool,
  officialUpdateStateTool,
] as const

export function createOfficialAgentToolRegistry() {
  return createAgentToolRegistry(
    officialAgentToolDefinitions,
    [officialSearchContextRegistration, officialReadContextRegistration, officialReadStateRegistration, officialUpdateStateRegistration],
  )
}
