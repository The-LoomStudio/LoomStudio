import { describe, expect, it } from 'vitest'
import { developmentDataEnvironment } from '../../../scripts/lib/development-data-paths.mjs'

describe('development data layout', () => {
  it('defaults only persistent data to repository/data and preserves overrides', () => {
    expect(developmentDataEnvironment('/repo', {})).toMatchObject({
      LOOM_STUDIO_HOME: '/repo/.loomstudio-dev',
      LOOM_STUDIO_DATA_ROOT: '/repo/data',
    })
    expect(developmentDataEnvironment('/repo', { LOOM_STUDIO_HOME: '/custom' }).LOOM_STUDIO_DATA_ROOT).toBe('/custom/data')
    expect(developmentDataEnvironment('/repo', { LOOM_STUDIO_DATA_ROOT: '/other' }).LOOM_STUDIO_DATA_ROOT).toBe('/other')
  })

})
