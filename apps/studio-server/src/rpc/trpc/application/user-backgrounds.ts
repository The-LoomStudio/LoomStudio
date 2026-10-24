import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { readNumber, readString } from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

function readExpectedVersion(params: JsonValue | undefined): number {
  const version = readNumber(params, 'expectedVersion')
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid user backgrounds configuration version')
  return version
}

export const userBackgroundsProcedures = {
  getUserBackgrounds: procedure.query(({ ctx }) => ctx.runtime.getUserBackgrounds()),
  addUserBackground: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['addUserBackground']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    name: readString(params, 'name'),
    assetId: readString(params, 'assetId'),
  }))).mutation(({ ctx, input }) => ctx.runtime.addUserBackground(input, ctx.request)),
  removeUserBackground: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['removeUserBackground']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    backgroundId: readString(params, 'backgroundId'),
  }))).mutation(({ ctx, input }) => ctx.runtime.removeUserBackground(input, ctx.request)),
}
