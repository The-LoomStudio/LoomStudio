import { defineServerExtension } from '@loom-studio/extension-sdk'

export const activate = defineServerExtension({
  activate: ctx => {
    ctx.state.contribute({
      id: 'example.echo.character-status',
      entityTypes: [],
      templates: [{
        id: 'example.echo.character-status',
        templateVersion: 1,
        componentKey: 'echoStatus',
        targetEntityTypeIds: ['character'],
        label: 'Example Echo Status',
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        initial: { message: 'Hello from Example Echo' },
      }],
      entities: [],
      componentMounts: [{
        templateId: 'example.echo.character-status',
        templateVersion: 1,
        componentKey: 'echoStatus',
        target: { kind: 'entity-type', typeId: 'character' },
      }],
      bindings: [],
    })

    ctx.macros.register({
      id: 'example.echo.greeting',
      name: 'example.echo.greeting',
      resolve: () => 'Hello from Example Echo',
    })

    ctx.macros.register({
      id: 'example.echo.timeline_state',
      name: 'example.echo.timeline_state',
      resolve: context => {
        const hp = readPath(context.timeline, ['entities', 'characters', 'archive_keeper', 'components', 'vitals', 'hp'])
        return hp === undefined ? 'Archive Keeper HP: unavailable' : `Archive Keeper HP: ${String(hp)}`
      },
    })

    ctx.rpc.register('example.echo.echo', params => {
      return {
        packageId: ctx.extension.packageId,
        moduleId: ctx.extension.moduleId,
        echo: params ?? null,
      }
    })

    ctx.lifecycle.onDispose(() => {
      ctx.diagnostics.report({
        severity: 'info',
        code: 'example.echo.disposed',
        message: 'Example Echo disposed',
      })
    })
  },
}).activate

function readPath(root: unknown, path: string[]): unknown {
  let current = root
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
