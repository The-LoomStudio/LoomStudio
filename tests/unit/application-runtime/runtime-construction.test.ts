import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it, onTestFinished } from 'vitest'

describe('Application Runtime construction', () => {
  it('rejects construction without the shared Prompt Resource Store', () => {
    const documents = createInMemoryDocumentStore()
    onTestFinished(() => documents.close())
    expect(() => Reflect.apply(createApplicationRuntime, undefined, [{
      documents,
    }])).toThrow('Prompt Resource Store is required')
  })
})
