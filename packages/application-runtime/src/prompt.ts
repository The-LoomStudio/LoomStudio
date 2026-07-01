import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { runPromptBuildPipeline, type PromptBuildPipelineResult } from './prompt-build-pipeline.js'
import { emptyProjectionOrderProfile, type ProjectionOrderProfile } from './prompt-builder.js'
import type { ActivationFacts } from './prompt-activation.js'
import type { NarrativeBranchContent, SessionContent } from './types.js'

export async function composePromptBuildForInput(
  documents: DocumentStore,
  session: DocumentRecord<SessionContent>,
  branch: DocumentRecord<NarrativeBranchContent>,
  userInput: string,
  orderProfile: ProjectionOrderProfile = emptyProjectionOrderProfile,
  workspaceId?: string,
  activationFacts?: ActivationFacts,
): Promise<PromptBuildPipelineResult> {
  return await runPromptBuildPipeline({
    activationFacts,
    branch,
    documents,
    orderProfile,
    session,
    userInput,
    workspaceId,
  })
}
