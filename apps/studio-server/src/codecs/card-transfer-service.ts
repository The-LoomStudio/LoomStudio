import type { createApplicationRuntime } from '@loom-studio/application-runtime'
import type { AssetStore } from '@loom-studio/asset-store'
import type { createCardDirectoryMedia } from '../resource-directories/card-directory-media.js'
import type { createExtensionImportConversions } from '../extensions/import-conversion.js'
import type { createStudioHttpServer } from '../http/http-server.js'
import {
  createPolyglotCardPng,
  defaultCardPng,
  encodeCardBundlePng,
  readCardPngArchive,
  stripPngTextMetadata,
  isPng,
  readPngImageBytes,
  readPolyglotArchive,
} from './card-png.js'
import { decodeCardBundleZip, encodeCardBundleZip, type CardBundleMedia } from './card-bundle-zip.js'

type Dependencies = {
  applicationRuntime: ReturnType<typeof createApplicationRuntime>
  assets?: AssetStore
  directoryMedia: ReturnType<typeof createCardDirectoryMedia>
  importConversions: ReturnType<typeof createExtensionImportConversions>
  saveImportedCard(id: string): Promise<void>
}

export function createCardTransferService({ applicationRuntime, assets, directoryMedia, importConversions, saveImportedCard }: Dependencies) {
  const readCardMedia = async (cardId: string, kind: 'avatar' | 'background', assetId?: string, forExport = false): Promise<(CardBundleMedia & { etag?: string }) | undefined> => {
    const directory = await directoryMedia.read(cardId, kind, assetId, forExport)
    if (directory) return directory
    if (!assetId) return kind === 'avatar' ? { bytes: defaultCardPng, mediaType: 'image/png' } : undefined
    const media = await assets?.getMediaAsset(assetId)
    if (!media) throw new Error(`Card media Asset is missing: ${assetId}`)
    let bytes = await assets!.readMediaAsset(assetId, { maxBytes: 64 * 1024 * 1024 })
    const mediaType = media.mediaType ?? 'application/octet-stream'
    if (mediaType === 'image/png' && isPng(bytes)) bytes = stripPngTextMetadata(bytes)
    return { bytes, mediaType }
  }
  const readCardExport = async (cardId: string) => {
    const { artifact, snapshot } = await applicationRuntime.captureCardDirectoryState({ cardId })
    const avatar = (await readCardMedia(cardId, 'avatar', artifact.card.media?.avatarAssetId, true))!
    return {
      artifact,
      snapshot,
      avatar,
      background: await readCardMedia(cardId, 'background', artifact.card.media?.coverAssetId, true),
    }
  }
  const importCardArchive = async (input: Awaited<ReturnType<typeof decodeCardBundleZip>>, clientId: string, newCardId?: string) => {
    input.artifact.card.media = await prepareUpdateMedia(input, clientId)
    return applicationRuntime.importCardBundle({ artifact: input.artifact, newCardId }, { clientId })
  }
  const prepareUpdateMedia = async (input: Pick<Awaited<ReturnType<typeof decodeCardBundleZip>>, 'avatar' | 'background'>, clientId: string) => {
    if (!assets) throw new Error('Assets unavailable')
    const createMedia = async (media: CardBundleMedia, kind: string) => (await assets!.createMediaAsset({
      source: media.mediaType === 'image/png' && isPng(media.bytes) ? stripPngTextMetadata(media.bytes) : media.bytes,
      kind,
      mediaType: media.mediaType,
      maxBytes: 64 * 1024 * 1024,
      actor: { kind: 'client', id: clientId },
      reason: 'application.importLoomCard.media',
    })).asset.id
    const avatarAssetId = await createMedia(input.avatar, 'card.avatar')
    const coverAssetId = input.background ? await createMedia(input.background, 'card.background') : undefined
    // ponytail: AssetStore writes precede the Card CAS; rejection can leave unreferenced
    // immutable assets. Reclaim through the shared asset lifecycle, not by deleting blobs here.
    return { avatarAssetId, ...(coverAssetId ? { coverAssetId } : {}) }
  }
  const finishImportedCard = async (result: Awaited<ReturnType<typeof applicationRuntime.importCardBundle>>) => {
    await saveImportedCard(result.card.id).catch(error => { throw new Error(`Card imported as ${result.card.id}, but directory save failed. Do not import again. ${error instanceof Error ? error.message : String(error)}`) })
    return result
  }
  const importArchiveAndSave = async (input: Awaited<ReturnType<typeof decodeCardBundleZip>>, clientId: string) => {
    return finishImportedCard(await importCardArchive(input, clientId))
  }
  const importPng = async (source: Uint8Array, clientId: string) => {
    if (!assets) throw new Error('Assets unavailable')

        const archive = readCardPngArchive(source) ?? readPolyglotArchive(source)
        if (archive) return await importArchiveAndSave(await decodeCardBundleZip(archive), clientId)
        const converted = await importConversions.cardPng(source, { clientId: clientId })
        const artifact = converted.artifact
        const avatarBytes = converted.avatarBytes ?? readPngImageBytes(source)
        const media = await assets.createMediaAsset({
          source: stripPngTextMetadata(avatarBytes),
          kind: 'card.avatar',
          mediaType: 'image/png',
          maxBytes: 32 * 1024 * 1024,
          actor: { kind: 'client', id: clientId },
          reason: 'application.importCardPng.media',
        })
        artifact.card.media = {
          avatarAssetId: media.asset.id,
        }
        const result = await applicationRuntime.importCardBundle({ artifact }, { clientId: clientId })
        return finishImportedCard(result)

  }
  const http: Pick<Parameters<typeof createStudioHttpServer>[0], 'cardMedia' | 'cardPng'> = {
    cardMedia: {
      read: async (cardId, kind) => {
        const { card } = await applicationRuntime.getCard({ cardId })
        return readCardMedia(cardId, kind, kind === 'avatar' ? card.media?.avatarAssetId : card.media?.coverAssetId)
      },
    },
    cardPng: assets ? {
      export: async cardId => {
        const bundle = await readCardExport(cardId)
        const { avatar } = bundle
        // ponytail: M0 不引入图片转码依赖；非 PNG 头像暂用内置 PNG，接入图像管线后再统一转码。
        return encodeCardBundlePng(avatar.mediaType === 'image/png' && isPng(avatar.bytes) ? avatar.bytes : defaultCardPng, encodeCardBundleZip(bundle))
      },
      import: (source, session) => importPng(source, session.clientId),
      exportBundle: async cardId => encodeCardBundleZip(await readCardExport(cardId)),
      importBundle: async (source, session) => await importArchiveAndSave(await decodeCardBundleZip(source), session.clientId),
      exportPolyglot: async cardId => {
        const bundle = await readCardExport(cardId)
        const image = bundle.avatar.mediaType === 'image/png' && isPng(bundle.avatar.bytes) ? bundle.avatar.bytes : defaultCardPng
        return createPolyglotCardPng(image, encodeCardBundleZip(bundle))
      },
    } : undefined,
  }
  return { prepareUpdateMedia, readCardExport, importCardArchive, importArchiveAndSave, importDownloaded: async (source: Uint8Array, clientId: string) => isPng(source) ? importPng(source, clientId) : importArchiveAndSave(await decodeCardBundleZip(source), clientId), ...http }
}
