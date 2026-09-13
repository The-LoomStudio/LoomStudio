export { createPromptToolExecutionScope } from './context-snapshot.js'
export { officialReadContextTool } from './read-context.js'
export { officialSearchContextTool } from './search-context.js'
export { officialReadStateTool } from './read-state.js'
export { officialUpdateStateTool } from './update-state.js'
export { officialAppendNarrativeTool } from './append-narrative.js'
export { officialEditNarrativeTool } from './edit-narrative.js'
export { officialSearchPromptResourcesTool } from './search-prompt-resources.js'
export { officialReadPromptResourceTool } from './read-prompt-resource.js'
export { officialUpdatePromptResourceTool } from './update-prompt-resource.js'

import { createAgentToolRegistry } from '../tool-registry.js'
import { officialReadContextRegistration, officialReadContextTool } from './read-context.js'
import { officialSearchContextRegistration, officialSearchContextTool } from './search-context.js'
import { officialReadStateRegistration, officialReadStateTool } from './read-state.js'
import { officialUpdateStateRegistration, officialUpdateStateTool } from './update-state.js'
import { officialAppendNarrativeRegistration, officialAppendNarrativeTool } from './append-narrative.js'
import { officialEditNarrativeRegistration, officialEditNarrativeTool } from './edit-narrative.js'
import { officialSearchPromptResourcesRegistration, officialSearchPromptResourcesTool } from './search-prompt-resources.js'
import { officialReadPromptResourceRegistration, officialReadPromptResourceTool } from './read-prompt-resource.js'
import { officialUpdatePromptResourceRegistration, officialUpdatePromptResourceTool } from './update-prompt-resource.js'

export const officialAgentToolDefinitions = [
  officialSearchContextTool,
  officialReadContextTool,
  officialReadStateTool,
  officialUpdateStateTool,
  officialAppendNarrativeTool,
  officialEditNarrativeTool,
  officialSearchPromptResourcesTool,
  officialReadPromptResourceTool,
  officialUpdatePromptResourceTool,
] as const

export function createOfficialAgentToolRegistry() {
  return createAgentToolRegistry(
    officialAgentToolDefinitions,
    [
      officialSearchContextRegistration,
      officialReadContextRegistration,
      officialReadStateRegistration,
      officialUpdateStateRegistration,
      officialAppendNarrativeRegistration,
      officialEditNarrativeRegistration,
      officialSearchPromptResourcesRegistration,
      officialReadPromptResourceRegistration,
      officialUpdatePromptResourceRegistration,
    ],
  )
}
