import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord, readNumber, readOptionalString, readString } from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

function readExpectedVersion(params: JsonValue | undefined): number {
  const version = readNumber(params, 'expectedVersion')
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid user profiles configuration version')
  return version
}

export const userProfilesProcedures = {
  getUserProfiles: procedure.query(({ ctx }) => ctx.runtime.getUserProfiles()),
  createUserProfile: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['createUserProfile']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    name: readOptionalString(params, 'name'),
    description: readOptionalString(params, 'description'),
  }))).mutation(({ ctx, input }) => ctx.runtime.createUserProfile(input, ctx.request)),
  updateUserProfile: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['updateUserProfile']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    profileId: readString(params, 'profileId'),
    name: readOptionalString(params, 'name'),
    description: readOptionalString(params, 'description'),
    avatarAssetId: isRecord(params) && params.avatarAssetId === null ? null : readOptionalString(params, 'avatarAssetId'),
  }))).mutation(({ ctx, input }) => ctx.runtime.updateUserProfile(input, ctx.request)),
  selectUserProfile: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['selectUserProfile']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    profileId: readString(params, 'profileId'),
  }))).mutation(({ ctx, input }) => ctx.runtime.selectUserProfile(input, ctx.request)),
  deleteUserProfile: procedure.input(jsonInput((params): Parameters<ApplicationRuntime['deleteUserProfile']>[0] => ({
    expectedVersion: readExpectedVersion(params),
    profileId: readString(params, 'profileId'),
  }))).mutation(({ ctx, input }) => ctx.runtime.deleteUserProfile(input, ctx.request)),
}
