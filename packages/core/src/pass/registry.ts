import type { Diagnostic } from '../diagnostic/types.js'
import type { Pass, PassConfig, PassFactory } from './types.js'

export class PassFactoryMissingError extends Error {
  constructor(public readonly factoryName: string) {
    super(`No PassFactory registered for "${factoryName}"`)
    this.name = 'PassFactoryMissingError'
  }
}

export class PassFactoryCreateError extends Error {
  constructor(
    public readonly factoryName: string,
    public readonly passIndex: number | undefined,
    cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`PassFactory "${factoryName}" threw: ${message}`)
    this.name = 'PassFactoryCreateError'
    this.cause = cause
  }
}

export class PassRegistry<M = unknown> {
  private readonly factories = new Map<string, PassFactory<unknown, M>>()

  register<P>(factory: PassFactory<P, M>): void {
    if (!factory || typeof factory !== 'object') {
      throw new Error('PassFactory must be an object')
    }
    if (typeof factory.name !== 'string' || factory.name.length === 0) {
      throw new Error('PassFactory must have a non-empty name')
    }
    if (typeof factory.create !== 'function') {
      throw new Error(`PassFactory "${factory.name}" must have create()`)
    }
    if (this.factories.has(factory.name)) {
      throw new Error(`PassFactory "${factory.name}" is already registered`)
    }
    this.factories.set(factory.name, factory as PassFactory<unknown, M>)
  }

  has(name: string): boolean {
    return this.factories.has(name)
  }

  create(config: PassConfig, passIndex?: number): Pass<M> {
    const factory = this.factories.get(config.name)
    if (!factory) {
      throw new PassFactoryMissingError(config.name)
    }
    try {
      return factory.create(config.params)
    } catch (error) {
      throw new PassFactoryCreateError(config.name, passIndex, error)
    }
  }

  createAll(configs: readonly PassConfig[]): readonly Pass<M>[] {
    return configs.map((config, index) => this.create(config, index))
  }
}

export function factoryDiagnostic(factoryName: string, error: unknown, passIndex?: number): Diagnostic {
  const missing = error instanceof PassFactoryMissingError
  const resolvedName = error instanceof PassFactoryMissingError || error instanceof PassFactoryCreateError
    ? error.factoryName
    : factoryName
  const resolvedIndex = error instanceof PassFactoryCreateError ? error.passIndex : passIndex
  const message = error instanceof Error ? error.message : String(error)
  return {
    severity: 'error',
    code: missing ? 'loom/factory-missing' : 'loom/factory-threw',
    message,
    pass: 'core',
    meta: {
      factoryName: resolvedName,
      ...(resolvedIndex !== undefined ? { passIndex: resolvedIndex } : {}),
    },
  }
}
