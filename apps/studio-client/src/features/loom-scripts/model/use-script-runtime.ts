import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ClientNotification, RegisteredClientBackground } from '@loom-studio/extension-sdk'
import type { ExtensionHostLogWriter } from '@loom-studio/logging'
import type { ResolvedLoomScriptRendererMount } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { subscribeExtensionEvents } from '../../../shared/api/extension-events.js'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { notify } from '../../../shared/notifications/index.js'
import { createClientExtensionDataApi } from '../../extension-renderers/model/use-client-extension-runtime.js'
import { createLoomScriptRendererRuntime } from '../runtime/loom-script-renderer-runtime.js'
import { createClientScriptRuntime } from './client-script-runtime.js'
import { sceneScriptDevelopment } from './scene-script-development.js'

type RendererRuntimeInput = Parameters<typeof createLoomScriptRendererRuntime>[0]
type Resolution = Awaited<ReturnType<StudioApi['loomScripts']['reconcileRuntime']>>

export function useScriptRuntime(input: {
  api: Pick<StudioApi, 'loomScripts' | 'extensionRuntime' | 'states' | 'textTransforms'>
  rendererHost: ClientRendererHost
  logger?: ExtensionHostLogWriter
  listBackgrounds(): readonly RegisteredClientBackground[]
  presetId?: string
  refreshToken: number
  resolveInputs: RendererRuntimeInput['resolveInputs']
  stateRead: RendererRuntimeInput['stateRead']
  notify(owner: string, notification: ClientNotification): void
  onResolved?(result: Resolution): void
}) {
  const latest = useRef(input)
  latest.current = input
  const runtime = useMemo(() => ({
    active: false,
    request: 0,
    mounts: [] as ResolvedLoomScriptRendererMount[],
    scope: input.rendererHost.scopeSnapshot(),
    renderer: createLoomScriptRendererRuntime({
      rendererHost: input.rendererHost,
      resolveInputs: (...args) => latest.current.resolveInputs(...args),
      stateRead: target => latest.current.stateRead(target),
      notify: (...args) => latest.current.notify(...args),
    }),
    client: createClientScriptRuntime({
      rendererHost: input.rendererHost,
      data: createClientExtensionDataApi(input.api),
      logger: input.logger,
      listBackgrounds: () => latest.current.listBackgrounds(),
      notify: (...args) => latest.current.notify(...args),
    }),
  }), [input.rendererHost, input.api, input.logger])

  const reconcile = useCallback(async () => {
    runtime.renderer.reconcile(runtime.mounts.filter(mount => mount.script.runtime === 'client-sandbox').map(mount => ({ ...mount, script: { ...mount.script, contributions: mount.script.contributions.filter(item => item.kind === 'renderer') } })))
    await runtime.client.reconcile(runtime.mounts, import.meta.env.DEV ? sceneScriptDevelopment.overrides() : undefined)
    if (!runtime.active) return
    for (const diagnostic of runtime.client.host.diagnostics()) {
      notify.error(diagnostic.message, { id: `loom-script-client:${diagnostic.moduleId}:${diagnostic.code}` })
    }
  }, [runtime])

  const refresh = useCallback(async () => {
    const request = ++runtime.request
    const scope = input.rendererHost.scopeSnapshot()
    try {
      const result = await input.api.loomScripts.reconcileRuntime({
        workspaceId: scope.workspace,
        ...(scope.cardId ? { cardId: scope.cardId } : {}),
        ...(scope.timelineId ? { timelineId: scope.timelineId } : {}),
        ...(latest.current.presetId ? { presetId: latest.current.presetId } : {}),
      })
      if (!runtime.active || request !== runtime.request) return
      runtime.mounts = result.mounts.filter(mount => mount.target?.kind !== 'workspace' || Boolean(scope.timelineId))
      runtime.scope = scope
      await reconcile()
      if (!runtime.active || request !== runtime.request) return
      for (const mount of result.unavailableMounts) {
        if (mount.enabled) notify.warning(mount.message, { id: `loom-script-unavailable:${mount.mountId}` })
      }
      for (const instance of result.serverInstances ?? []) {
        if (instance.state === 'active') continue
        const message = instance.diagnostics.map(diagnostic => diagnostic.message).join('\n') || `脚本 ${instance.mountId}：${instance.state}`
        notify.error(message, { id: `loom-script-server:${instance.mountId}` })
      }
      latest.current.onResolved?.(result)
    } catch (error) {
      if (runtime.active && request === runtime.request) notify.error(readError(error), { id: 'loom-script-resolution' })
    }
  }, [input.api, input.rendererHost, reconcile, runtime])

  useEffect(() => {
    runtime.active = true
    const unsubscribeDevelopment = import.meta.env.DEV ? sceneScriptDevelopment.subscribe(() => {
      void reconcile().catch(error => { if (runtime.active) notify.error(readError(error)) })
    }) : undefined
    const pruneContext = () => {
      const scope = input.rendererHost.scopeSnapshot()
      if (JSON.stringify(scope) === JSON.stringify(runtime.scope)) return
      const previous = runtime.scope
      runtime.scope = scope
      runtime.request++
      runtime.mounts = runtime.mounts.filter(mount => {
        if (mount.target?.kind === 'card') return mount.target.cardId === scope.cardId
        if (mount.target?.kind === 'workspace') return Boolean(scope.timelineId) && scope.timelineId === previous.timelineId
        return true
      })
      // Removing a scope aborts its old Host before waiting for the next resolver request.
      void reconcile().catch(error => { if (runtime.active) notify.error(readError(error)) })
      void refresh()
    }
    const unsubscribeScope = input.rendererHost.subscribe(pruneContext)
    const unsubscribeEvents = typeof EventSource === 'undefined' ? undefined : subscribeExtensionEvents({
      onConnected: () => { void refresh() },
      events: {
        'extensions.changed': () => { void refresh() },
        'extensions.data.changed': () => {
          void runtime.client.host.notifyStateChanged().catch(error => { if (runtime.active) notify.error(readError(error)) })
          void refresh()
        },
      },
    })
    return () => {
      unsubscribeDevelopment?.()
      runtime.active = false
      runtime.request++
      unsubscribeScope()
      unsubscribeEvents?.()
      runtime.renderer.dispose()
      void runtime.client.dispose()
      runtime.mounts = []
    }
  }, [input.rendererHost, reconcile, refresh, runtime])

  useEffect(() => { void refresh() }, [refresh, input.presetId, input.refreshToken])
}

function readError(error: unknown) { return error instanceof Error ? error.message : String(error) }
