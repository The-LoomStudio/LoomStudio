import type { ApplicationRuntime, LoomScriptOwner, RuntimeRequestContext } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readBoolean,
  readNumber,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
  readStringArray,
} from '../../rpc-params.js'

export async function handleLoomScriptsRpc(
  applicationRuntime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.importLoomScript':
      return await applicationRuntime.importLoomScript({ owner: readOwner(params, 'owner'), fileName: readString(params, 'fileName'), source: readString(params, 'source') }, context) as unknown as JsonValue
    case 'application.updateLoomScript':
      return await applicationRuntime.updateLoomScript({ scriptDocumentId: readString(params, 'scriptDocumentId'), expectedVersion: readNumber(params, 'expectedVersion'), fileName: readString(params, 'fileName'), source: readString(params, 'source') }, context) as unknown as JsonValue
    case 'application.getLoomScript':
      return await applicationRuntime.getLoomScript({ scriptDocumentId: readString(params, 'scriptDocumentId') }) as unknown as JsonValue
    case 'application.listLoomScripts':
      return await applicationRuntime.listLoomScripts({ owner: readOptionalOwner(params, 'owner') }) as unknown as JsonValue
    case 'application.exportLoomScript':
      return await applicationRuntime.exportLoomScript({ scriptDocumentId: readString(params, 'scriptDocumentId') }) as unknown as JsonValue
    case 'application.createLoomScriptMount':
      return await applicationRuntime.createLoomScriptMount({ target: readOwner(params, 'target'), scriptDocumentId: readString(params, 'scriptDocumentId'), orderIndex: readNumber(params, 'orderIndex'), pinnedDocumentVersion: readOptionalNumber(params, 'pinnedDocumentVersion'), origin: readOptionalObject(params, 'origin') }, context) as unknown as JsonValue
    case 'application.updateLoomScriptMount':
      return await applicationRuntime.updateLoomScriptMount({ mountId: readString(params, 'mountId'), expectedVersion: readNumber(params, 'expectedVersion'), enabled: readBoolean(params, 'enabled'), orderIndex: readNumber(params, 'orderIndex'), pinnedDocumentVersion: readOptionalNumber(params, 'pinnedDocumentVersion'), grantedCapabilities: readStringArray(params, 'grantedCapabilities') }, context) as unknown as JsonValue
    case 'application.listLoomScriptMounts':
      return await applicationRuntime.listLoomScriptMounts({ target: readOptionalOwner(params, 'target'), scriptDocumentId: readOptionalString(params, 'scriptDocumentId') }) as unknown as JsonValue
    case 'application.resolveLoomScriptRendererMounts':
      return await applicationRuntime.resolveLoomScriptRendererMounts({
        workspaceId: readOptionalString(params, 'workspaceId'),
        timelineId: readOptionalString(params, 'timelineId'),
        presetId: readOptionalString(params, 'presetId'),
      }) as unknown as JsonValue
    default:
      return undefined
  }
}

function readOwner(value: JsonValue | undefined, key: string): LoomScriptOwner {
  const owner = isRecord(value) && isRecord(value[key]) ? value[key] : undefined
  if (!owner) throw new Error(`Expected Loom Script owner: ${key}`)
  if (owner.kind === 'user') return { kind: 'user' }
  if (owner.kind === 'workspace' && typeof owner.workspaceId === 'string') return { kind: 'workspace', workspaceId: owner.workspaceId }
  if (owner.kind === 'card' && typeof owner.cardId === 'string') return { kind: 'card', cardId: owner.cardId }
  if (owner.kind === 'preset' && typeof owner.presetId === 'string') return { kind: 'preset', presetId: owner.presetId }
  throw new Error(`Invalid Loom Script owner: ${key}`)
}

function readOptionalOwner(value: JsonValue | undefined, key: string): LoomScriptOwner | undefined {
  return isRecord(value) && value[key] !== undefined ? readOwner(value, key) : undefined
}
