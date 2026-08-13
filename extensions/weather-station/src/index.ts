import { defineServerExtension, type JsonValue } from '@loom-studio/extension-sdk'

const documentId = 'example.weatherStation:state'
const documentType = 'example.weatherStation.state'

type WeatherState = {
  temperatureC: number
  revision: number
}

type WeatherEvent = WeatherState & {
  documentId: string
}

const failDispose = process.env.LOOM_WEATHER_TEST_FAIL_DISPOSE === '1'

export const activate = defineServerExtension({
  activate: async ctx => {
    let documentChanges = 0
    let publicEvents = 0
    let privateEvents = 0
    let shouldFailSubscriber = false

    ctx.logger.info('Weather Station activation started', {
      phase: 'activate',
      instanceId: ctx.extension.instanceId,
    })

    ctx.events.define<WeatherEvent>({
      name: 'example.weatherStation.updated',
      version: 1,
      visibility: 'public',
      summary: 'Weather Station state changed',
      stability: 'experimental',
      maxPayloadBytes: 2_048,
      parse: parseWeatherEvent,
    })

    ctx.events.define<{ note: string }>({
      name: 'example.weatherStation.note',
      version: 1,
      visibility: 'public',
      summary: 'Weather Station emitted a bounded test note',
      stability: 'experimental',
      maxPayloadBytes: 64,
      parse: value => {
        const input = asRecord(value)
        if (typeof input.note !== 'string') throw new Error('note is required')
        return { note: input.note }
      },
    })

    ctx.events.define<WeatherEvent>({
      name: 'example.weatherStation.privateSnapshot',
      version: 1,
      visibility: 'protected',
      summary: 'Weather Station emitted a private state snapshot',
      stability: 'experimental',
      maxPayloadBytes: 2_048,
      parse: parseWeatherEvent,
    })

    ctx.events.subscribe(['docs.changed'], event => {
      const payload = asRecord(event.payload)
      const documents = Array.isArray(payload.documents) ? payload.documents : []
      if (documents.some(item => asRecord(item).id === documentId)) documentChanges += 1
    })

    ctx.events.subscribe(['example.weatherStation.updated'], () => {
      publicEvents += 1
      if (shouldFailSubscriber) {
        shouldFailSubscriber = false
        throw new Error('Weather Station intentional subscriber failure')
      }
    })

    ctx.events.subscribe(['example.weatherStation.privateSnapshot'], () => {
      privateEvents += 1
    })

    const existing = await ctx.documents.get<WeatherState>(documentId)
    if (!existing) {
      await ctx.documents.write({
        id: documentId,
        type: documentType,
        content: { temperatureC: 20, revision: 1 },
        expectedVersion: 'new',
        reason: 'weather-station.activate',
      })
    }

    ctx.rpc.register('example.weatherStation.status', async () => {
      const document = await ctx.documents.get<WeatherState>(documentId)
      return {
        extensionId: ctx.extension.id,
        instanceId: ctx.extension.instanceId,
        aborted: ctx.lifecycle.signal.aborted,
        grantedEventCapabilities: [...ctx.permissions.events.subscribe],
        documentVersion: document?.version ?? 0,
        state: document?.content ?? null,
        counters: { documentChanges, publicEvents, privateEvents },
      }
    })

    ctx.rpc.register('example.weatherStation.update', async params => {
      const input = asRecord(params)
      const temperatureC = input.temperatureC
      if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC)) {
        throw new Error('temperatureC must be a finite number')
      }

      const current = await ctx.documents.get<WeatherState>(documentId)
      if (!current) throw new Error('Weather Station state document is missing')
      const next: WeatherState = {
        temperatureC,
        revision: current.content.revision + 1,
      }
      await ctx.documents.write({
        id: documentId,
        type: documentType,
        content: next,
        expectedVersion: current.version,
        reason: 'weather-station.update',
      })

      const event: WeatherEvent = { documentId, ...next }
      const published = ctx.events.emit('example.weatherStation.updated', event)
      ctx.events.emit('example.weatherStation.privateSnapshot', event)
      return {
        state: next,
        eventId: published.meta.eventId,
        definitionVersion: published.meta.definitionVersion,
      }
    })

    ctx.rpc.register('example.weatherStation.failSubscriber', () => {
      shouldFailSubscriber = true
      const event: WeatherEvent = {
        documentId,
        temperatureC: 999,
        revision: -1,
      }
      ctx.events.emit('example.weatherStation.updated', event)
      return { published: true }
    })

    ctx.rpc.register('example.weatherStation.publishNote', params => {
      const input = asRecord(params)
      return ctx.events.emit('example.weatherStation.note', {
        note: typeof input.note === 'string' ? input.note : '',
      }) as unknown as JsonValue
    })

    ctx.lifecycle.onDispose(() => {
      if (!failDispose) return
      ctx.diagnostics.report({
        severity: 'info',
        code: 'example.weatherStation.dispose.first',
        message: `First disposer observed aborted=${ctx.lifecycle.signal.aborted}`,
      })
    })
    ctx.lifecycle.onDispose(() => {
      if (!failDispose) return
      ctx.diagnostics.report({
        severity: 'info',
        code: 'example.weatherStation.dispose.failure',
        message: 'Intentional disposer failure for cleanup isolation verification',
      })
      throw new Error('Weather Station intentional disposer failure')
    })
    ctx.lifecycle.onDispose(() => {
      if (!failDispose) return
      ctx.diagnostics.report({
        severity: 'info',
        code: 'example.weatherStation.dispose.last',
        message: `Last registered disposer observed aborted=${ctx.lifecycle.signal.aborted}`,
      })
    })

    ctx.diagnostics.report({
      severity: 'info',
      code: 'example.weatherStation.ready',
      message: 'Weather Station test extension is ready',
    })
    ctx.logger.info('Weather Station activation completed', { phase: 'active' })
  },
}).activate

function parseWeatherEvent(value: unknown): WeatherEvent {
  const input = asRecord(value)
  if (typeof input.documentId !== 'string') throw new Error('documentId is required')
  if (typeof input.temperatureC !== 'number' || !Number.isFinite(input.temperatureC)) {
    throw new Error('temperatureC must be finite')
  }
  if (typeof input.revision !== 'number' || !Number.isInteger(input.revision)) {
    throw new Error('revision must be an integer')
  }
  return {
    documentId: input.documentId,
    temperatureC: input.temperatureC,
    revision: input.revision,
  }
}

function asRecord(value: JsonValue | unknown): Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {}
}
