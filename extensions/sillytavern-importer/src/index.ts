import { defineServerExtension } from '@loom-studio/extension-sdk'
import { isRecord, type JsonValue } from '@loom-studio/shared'
import { extractPngImageBytes, extractStCardFromPng, isPngFile } from './parser/png-reader.js'
import { sniffData } from './parser/sniffer.js'
import { convertSillyTavernCard } from './normalizer/card.js'
import { convertSillyTavernLorebook } from './normalizer/lorebook.js'
import { convertSillyTavernPreset } from './normalizer/preset.js'
import type { SillyTavernCard, SillyTavernLorebookData, SillyTavernPresetData } from './types.js'

export {
  extractPngImageBytes,
  extractStCardFromPng,
  isPngFile,
  sniffData,
  convertSillyTavernCard,
  convertSillyTavernLorebook,
  convertSillyTavernPreset,
}

export * from './types.js'

export const activate = defineServerExtension({
  activate: ctx => {
    // 1. Sniff method
    ctx.rpc.register('sillytavern.importer.sniff', params => {
      if (!isRecord(params)) return { detected: false, format: 'unknown' }
      const source = params.source
      if (typeof source === 'string') {
        return sniffData(source)
      }
      if (Array.isArray(source)) {
        return sniffData(new Uint8Array(source as number[]))
      }
      if (isRecord(source)) {
        return sniffData(source)
      }
      return { detected: false, format: 'unknown' }
    })

    // 2. Convert Card
    ctx.rpc.register('sillytavern.importer.convertCard', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: Uint8Array | SillyTavernCard
      if (typeof params.base64 === 'string') {
        source = Buffer.from(params.base64, 'base64')
      } else if (Array.isArray(params.bytes)) {
        source = new Uint8Array(params.bytes as number[])
      } else if (isRecord(params.card)) {
        source = params.card as unknown as SillyTavernCard
      } else {
        throw new Error('convertCard requires base64, bytes, or card param')
      }
      const result = convertSillyTavernCard(source)
      return {
        artifact: result.artifact,
        sourceFormat: result.sourceFormat,
        avatarBase64: result.avatarBytes ? Buffer.from(result.avatarBytes).toString('base64') : undefined,
      } as unknown as JsonValue
    })

    // 3. Convert Lorebook
    ctx.rpc.register('sillytavern.importer.convertLorebook', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: string | SillyTavernLorebookData
      if (typeof params.json === 'string') {
        source = params.json
      } else if (isRecord(params.lorebook)) {
        source = params.lorebook as unknown as SillyTavernLorebookData
      } else {
        throw new Error('convertLorebook requires json or lorebook param')
      }
      const result = convertSillyTavernLorebook(source)
      return {
        artifact: result.artifact,
      } as unknown as JsonValue
    })

    // 4. Convert Preset
    ctx.rpc.register('sillytavern.importer.convertPreset', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: string | SillyTavernPresetData
      if (typeof params.json === 'string') {
        source = params.json
      } else if (isRecord(params.preset)) {
        source = params.preset as unknown as SillyTavernPresetData
      } else {
        throw new Error('convertPreset requires json or preset param')
      }
      const result = convertSillyTavernPreset(source, typeof params.name === 'string' ? params.name : undefined)
      return {
        artifact: result.artifact,
      } as unknown as JsonValue
    })

    ctx.lifecycle.onDispose(() => {
      ctx.diagnostics.report({
        severity: 'info',
        code: 'sillytavern.importer.disposed',
        message: 'SillyTavern Importer Extension disposed',
      })
    })
  },
}).activate

export default activate
