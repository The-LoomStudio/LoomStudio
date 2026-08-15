import { defineServerExtension } from '@loom-studio/extension-sdk'

export const activate = defineServerExtension({
  activate: ctx => {
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
