import { describe, expect, it } from 'vitest'
import { constrainImage, fitImage, zoomImage } from '../../../apps/studio-client/src/shared/ui/media-viewer/image-transform.js'

describe('image viewer transforms', () => {
  it('fits portrait media without cropping or upscaling small images', () => {
    expect(fitImage({ width: 2000, height: 3000 }, { width: 800, height: 600 })).toEqual({ scale: 0.2, x: 0, y: 0 })
    expect(fitImage({ width: 100, height: 100 }, { width: 800, height: 600 }).scale).toBe(1)
  })
  it('preserves the image point beneath the zoom anchor', () => {
    const image = { width: 2000, height: 2000 }
    const viewport = { width: 800, height: 600 }
    const result = zoomImage({ scale: 1, x: 20, y: 30 }, 2, { x: 100, y: 80 }, image, viewport)
    expect((100 - result.x) / result.scale).toBe(80)
    expect((80 - result.y) / result.scale).toBe(50)
  })
  it('limits dragging to the scaled image edges and recenters an image smaller than the viewport', () => {
    const image = { width: 1000, height: 800 }
    const viewport = { width: 800, height: 600 }
    expect(constrainImage({ scale: 1, x: 1000, y: -1000 }, image, viewport)).toEqual({ scale: 1, x: 100, y: -100 })
    const centered = constrainImage({ scale: 0.5, x: 100, y: -100 }, image, viewport)
    expect(centered.x).toBeCloseTo(0)
    expect(centered.y).toBeCloseTo(0)
  })
})
