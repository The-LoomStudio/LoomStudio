import type {
  ClientActionPlacement,
  ClientActionSurface,
  ClientCommandDeclaration,
  ClientCommandInvocationContext,
} from '@loom-studio/extension-sdk'
import type { ManagedExtensionPackage } from '../../../entities/index.js'

export type ResolvedClientAction = {
  key: string
  packageId: string
  moduleId: string
  command: ClientCommandDeclaration
  placement: ClientActionPlacement
}

export function clientCommandKey(packageId: string, moduleId: string, commandId: string): string {
  return `${packageId}/${moduleId}/${commandId}`
}

export function listClientActions(input: {
  packages: readonly ManagedExtensionPackage[]
  surface: ClientActionSurface
  context: ClientCommandInvocationContext
}): ResolvedClientAction[] {
  const actions: ResolvedClientAction[] = []
  for (const extensionPackage of input.packages) {
    for (const module of extensionPackage.modules) {
      if (module.runtimeKind !== 'client' || !module.desired.enabled) continue
      const commands = new Map((module.contributions.commands ?? []).map(command => [command.id, command]))
      for (const placement of module.contributions.actions ?? []) {
        if (placement.surface !== input.surface || !matchesClientActionCondition(placement, input.context)) continue
        const command = commands.get(placement.commandId)
        if (!command) continue
        actions.push({
          key: `${clientCommandKey(extensionPackage.packageId, module.moduleId, command.id)}@${placement.surface}@${placement.group ?? ''}`,
          packageId: extensionPackage.packageId,
          moduleId: module.moduleId,
          command,
          placement,
        })
      }
    }
  }
  return actions.sort((left, right) => {
    const group = (left.placement.group ?? '').localeCompare(right.placement.group ?? '')
    if (group) return group
    const suggested = (left.placement.suggestedOrder ?? 0) - (right.placement.suggestedOrder ?? 0)
    return suggested || left.key.localeCompare(right.key)
  })
}

export function matchesClientActionCondition(
  placement: ClientActionPlacement,
  context: ClientCommandInvocationContext,
): boolean {
  if (placement.when?.active === 'timeline') return Boolean(context.timelineId)
  if (placement.when?.active === 'agent-session') return Boolean(context.agentSessionId)
  return true
}
