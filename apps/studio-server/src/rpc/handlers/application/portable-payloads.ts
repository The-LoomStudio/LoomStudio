import type {
  ApplicationRuntime,
  PortableExtensionPayloadDraft,
  RuntimeRequestContext,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readNumber,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handlePortablePayloadsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.listPortableExtensionPayloads':
      return await runtime.listPortableExtensionPayloads({
        packageId: readOptionalString(params, 'packageId'),
      }) as unknown as JsonValue

    case 'application.getPortableExtensionPayload':
      return await runtime.getPortableExtensionPayload({
        payloadId: readString(params, 'payloadId'),
      }) as unknown as JsonValue

    case 'application.createPortableExtensionPayload':
      return await runtime.createPortableExtensionPayload({
        artifactPayloadId: readOptionalString(params, 'artifactPayloadId'),
        payload: readRequiredRecord(params, 'payload') as unknown as PortableExtensionPayloadDraft,
      }, context) as unknown as JsonValue

    case 'application.updatePortableExtensionPayload':
      return await runtime.updatePortableExtensionPayload({
        payloadId: readString(params, 'payloadId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        payload: readRequiredRecord(params, 'payload') as unknown as PortableExtensionPayloadDraft,
      }, context) as unknown as JsonValue

    case 'application.deletePortableExtensionPayload':
      return await runtime.deletePortableExtensionPayload({
        payloadId: readString(params, 'payloadId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
      }, context) as unknown as JsonValue

    case 'application.replaceCardPortableExtensionPayloads':
      return await runtime.replaceCardPortableExtensionPayloads({
        cardId: readString(params, 'cardId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        payloadIds: readRequiredStringArray(params, 'payloadIds'),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readRequiredRecord(value: JsonValue | undefined, key: string): Record<string, JsonValue> {
  if (!isRecord(value) || !isRecord(value[key])) throw new Error(`Expected object: ${key}`)
  return value[key]
}

function readRequiredStringArray(params: JsonValue | undefined, key: string): string[] {
  if (!isRecord(params) || !Array.isArray(params[key]) || !params[key].every(item => typeof item === 'string')) {
    throw new Error(`Expected string array param: ${key}`)
  }
  return params[key]
}
