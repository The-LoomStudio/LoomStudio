import { describe, expect, it } from 'vitest'
import { isUserPromptResource } from '../../../apps/studio-client/src/widgets/user-resources-panel/user-resources-panel.js'
import { readStudioRoute } from '../../../apps/studio-client/src/shared/studio-shell/studio-route.js'

describe('User resources navigation', () => {
  it('lists manually authored resources without claiming card imports or extension content', () => {
    expect(isUserPromptResource({})).toBe(true)
    expect(isUserPromptResource({ sourceArtifactRef: { artifactId: 'card-bundle' } })).toBe(false)
    expect(isUserPromptResource({ origin: { kind: 'builtin', key: 'starter' } })).toBe(false)
    expect(isUserPromptResource({ origin: {
      kind: 'extension-package', packageId: 'package', packageVersion: '1', contributionId: 'setting',
    } })).toBe(false)
  })

  it('resolves the User entry without changing the narrative target', () => {
    expect(readStudioRoute('/studio/user')).toEqual({ panel: 'user' })
  })
})
