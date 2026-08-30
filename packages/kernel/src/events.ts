import type {
  EventDefinition,
  EventDefinitionRegistrationOwner,
  EventPublishIdentity,
  EventSubscriberIdentity,
  RegisteredEventDefinition,
} from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import type {
  CreateEventBusOptions,
  EventBus,
  EventHandler,
} from './types.js'

export function createEventBus(options: CreateEventBusOptions = {}): EventBus {
  const definitions = new Map<string, RegisteredEventDefinition>()
  const subscriptions = new Map<string, {
    patterns: string[]
    handler: EventHandler
    subscriber: EventSubscriberIdentity
  }>()

  return {
    registerDefinition: (definition, registeredBy = { kind: 'platform' }) => {
      validateEventDefinition(definition, registeredBy)
      if (definitions.has(definition.name)) {
        throw new Error(`Event definition already registered: ${definition.name}`)
      }
      const registered = { definition, registeredBy } satisfies RegisteredEventDefinition
      definitions.set(definition.name, registered)

      return {
        dispose: () => {
          if (definitions.get(definition.name) === registered) definitions.delete(definition.name)
        },
      }
    },
    emit: (name, payload, emitOptions = {}) => {
      const registered = definitions.get(name)
      if (!registered) throw new Error(`Event definition not registered: ${name}`)
      assertCanPublish(registered, emitOptions.publisher ?? { kind: 'kernel' })
      const parsedPayload = registered.definition.parse?.(payload) ?? payload
      assertJsonValue(parsedPayload, `Event payload must be JSON-compatible: ${name}`)
      assertPayloadSize(registered.definition, parsedPayload)
      const event: StudioEvent = {
        name,
        payload: parsedPayload,
        meta: {
          eventId: createId('evt'),
          definitionVersion: registered.definition.version,
          emittedAt: nowIso(),
          source: emitOptions.source ?? 'kernel',
          clientId: emitOptions.clientId,
          correlationId: emitOptions.correlationId,
          callId: emitOptions.callId,
          parentCallId: emitOptions.parentCallId,
        },
      }

      for (const [subscriptionId, subscription] of subscriptions.entries()) {
        if (!subscription.patterns.some(pattern => matchesEventPattern(pattern, name))) continue
        if (!canSubscribe(registered.definition, subscription.subscriber)) continue
        try {
          const result = subscription.handler(event)
          if (isPromiseLike(result)) {
            void result.catch(error => options.onSubscriberError?.({
              event,
              subscriptionId,
              error,
            }))
          }
        } catch (error) {
          options.onSubscriberError?.({
            event,
            subscriptionId,
            error,
          })
        }
      }

      return event
    },
    subscribe: (patterns, handler, subscribeOptions = {}) => {
      if (patterns.length === 0) throw new Error('Event subscription requires at least one pattern')
      const subscriber = subscribeOptions.subscriber ?? { kind: 'platform' }
      assertCanSubscribePatterns(patterns, definitions, subscriber)
      const subscriptionId = createId('sub')
      subscriptions.set(subscriptionId, { patterns: [...patterns], handler, subscriber })

      return {
        subscriptionId,
        dispose: () => {
          subscriptions.delete(subscriptionId)
        },
      }
    },
    unsubscribe: subscriptionId => subscriptions.delete(subscriptionId),
    definitions: () => [...definitions.values()].sort((left, right) => left.definition.name.localeCompare(right.definition.name)),
    eventNames: () => [...definitions.keys()].sort(),
  }
}

export function registerBuiltinEventDefinitions(eventBus: EventBus): void {
  const definitions: EventDefinition[] = [
    platformEvent('data.changed', 'Low-level platform data commit completed', 'protected', 'platform-data'),
    platformEvent('docs.changed', 'Document Store commit completed', 'protected', 'documents'),
    platformEvent('docs.rollback.completed', 'Document changeset rollback completed', 'protected', 'documents'),
    platformEvent('docs.rollback.failed', 'Document changeset rollback failed', 'protected', 'documents'),
    platformEvent('diagnostics.updated', 'Diagnostics registry changed', 'protected', 'diagnostics'),
    platformEvent('extensions.changed', 'Extension runtime state changed', 'public'),
    platformEvent('extensions.data.changed', 'Extension-visible data projection may have changed', 'public'),
    platformEvent('entity.lifecycle.changed', 'Application entity lifecycle transaction completed', 'public'),
    platformEvent('system.ready', 'Kernel completed startup', 'public'),
    platformEvent('system.stopping', 'Kernel shutdown started', 'public'),
  ]

  for (const definition of definitions) eventBus.registerDefinition(definition)
}

export function platformEvent(
  name: string,
  summary: string,
  visibility: EventDefinition['visibility'],
  capability?: EventDefinition['capability'],
): EventDefinition {
  return {
    name,
    owner: { kind: 'kernel' },
    version: 1,
    visibility,
    capability,
    summary,
    stability: 'experimental',
    maxPayloadBytes: 64 * 1024,
  }
}

export function validateEventDefinition(definition: EventDefinition, registeredBy: EventDefinitionRegistrationOwner): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][A-Za-z0-9]+)+$/.test(definition.name)) {
    throw new Error(`Invalid event name: ${definition.name}`)
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Event definition version must be a positive integer: ${definition.name}`)
  }
  if (!definition.summary.trim()) throw new Error(`Event definition summary is required: ${definition.name}`)
  if (definition.maxPayloadBytes !== undefined && (!Number.isInteger(definition.maxPayloadBytes) || definition.maxPayloadBytes < 1)) {
    throw new Error(`Event maxPayloadBytes must be a positive integer: ${definition.name}`)
  }
  if (definition.visibility === 'protected' && !definition.capability) {
    throw new Error(`Protected event requires a capability: ${definition.name}`)
  }
  if (definition.visibility !== 'protected' && definition.capability) {
    throw new Error(`Only protected events may declare a capability: ${definition.name}`)
  }

  if (registeredBy.kind !== 'extension') return
  if (
    definition.owner.kind !== 'extension'
    || definition.owner.packageId !== registeredBy.packageId
    || definition.owner.moduleId !== registeredBy.moduleId
  ) {
    throw new Error(`Extension event owner mismatch: ${definition.name}`)
  }
  if (!definition.name.startsWith(`${registeredBy.packageId}.`)) {
    throw new Error(`Extension event must use its package namespace: ${definition.name}`)
  }
  if (definition.visibility === 'internal') {
    throw new Error(`Extension cannot register internal event: ${definition.name}`)
  }
  if (definition.visibility === 'protected' && definition.capability !== `extension:${registeredBy.packageId}`) {
    throw new Error(`Extension protected event must use its extension capability: ${definition.name}`)
  }
}

export function assertCanPublish(registered: RegisteredEventDefinition, publisher: EventPublishIdentity): void {
  const owner = registered.definition.owner
  if (owner.kind === 'extension') {
    if (
      publisher.kind === 'extension'
      && publisher.packageId === owner.packageId
      && publisher.moduleId === owner.moduleId
    ) return
    throw new Error(`Event publisher does not own definition: ${registered.definition.name}`)
  }
  if (publisher.kind !== owner.kind) {
    throw new Error(`Event publisher does not own definition: ${registered.definition.name}`)
  }
}

export function assertCanSubscribePatterns(
  patterns: string[],
  definitions: Map<string, RegisteredEventDefinition>,
  subscriber: EventSubscriberIdentity,
): void {
  if (subscriber.kind === 'platform') return
  for (const registered of definitions.values()) {
    if (!patterns.some(pattern => matchesEventPattern(pattern, registered.definition.name))) continue
    if (!canSubscribe(registered.definition, subscriber)) {
      throw new Error(`Extension is not allowed to subscribe to event: ${registered.definition.name}`)
    }
  }
}

export function canSubscribe(definition: EventDefinition, subscriber: EventSubscriberIdentity): boolean {
  if (subscriber.kind === 'platform') return true
  if (definition.visibility === 'internal') return false
  if (definition.visibility === 'public') return true
  return Boolean(definition.capability && subscriber.capabilities.includes(definition.capability))
}

export function assertPayloadSize(definition: EventDefinition, payload: JsonValue): void {
  if (!definition.maxPayloadBytes) return
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (size > definition.maxPayloadBytes) {
    throw new Error(`Event payload exceeds ${definition.maxPayloadBytes} bytes: ${definition.name}`)
  }
}

export function assertJsonValue(value: unknown, message: string): asserts value is JsonValue {
  if (!isJsonValue(value, new Set())) throw new Error(message)
}

export function isJsonValue(value: unknown, ancestors: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value).every(item => isJsonValue(item, ancestors))
  ancestors.delete(value)
  return valid
}

export function isPromiseLike(value: unknown): value is Promise<void> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function'
}

export function matchesEventPattern(pattern: string, name: string): boolean {
  if (pattern.endsWith('.*')) {
    return name.startsWith(pattern.slice(0, -1))
  }

  return pattern === name
}
