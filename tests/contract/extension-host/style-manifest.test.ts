import { parseExtensionManifest } from '@loom-studio/extension-host'
import { describe, expect, it } from 'vitest'

const base = { manifestVersion: 2, id: 'example.theme', version: '1.0.0', displayName: 'Theme', engines: { studio: '*' } }
const theme = { id: 'paper', label: 'Paper', css: './styles/paper.css' }
const number = { id: 'size', label: 'Size', variable: '--extension-size', type: 'number', min: 8, max: 24, default: 16, unit: 'px' }
const parse = (contribution: unknown) => parseExtensionManifest({ ...base, contributes: { themes: [contribution] } })

describe('style manifest contract', () => {
  it('accepts CSS-only themes, enhancements and bounded parameters without modules', () => {
    expect(parseExtensionManifest({ ...base, contributes: {
      themes: [{ ...theme, parameters: [number] }], styles: [{ ...theme, id: 'compact' }],
    } }).contributes?.themes?.[0].css).toBe(theme.css)
  })
  it.each(['../paper.css', 'styles/../../paper.css', '/paper.css', 'https://a/paper.css', 'paper.css?x', 'paper.css#x', '%2e%2e/paper.css', 'a\\paper.css'])('rejects CSS path %s', css => {
    expect(() => parse({ ...theme, css })).toThrow()
  })
  it('requires unique shared contribution identities and global participation', () => {
    expect(() => parseExtensionManifest({ ...base, contributes: { themes: [theme], styles: [theme] } })).toThrow('duplicated')
    expect(() => parseExtensionManifest({ ...base, participation: 'timeline', contributes: { themes: [theme] } })).toThrow('Timeline')
  })
  it('resolves JS only to an existing client module and makes CSS-only fallback explicit', () => {
    expect(() => parse({ ...theme, moduleId: 'missing' })).toThrow('client module')
    expect(() => parse({ ...theme, supportsCssOnly: true })).toThrow('requires moduleId')
    for (const runtime of ['server', 'client']) {
      const manifest = { ...base, modules: [{ id: 'visual', runtime, entry: './index.js' }], contributes: { themes: [{ ...theme, moduleId: 'visual', supportsCssOnly: true }] } }
      if (runtime === 'server') expect(() => parseExtensionManifest(manifest)).toThrow('client module')
      else expect(parseExtensionManifest(manifest).contributes?.themes?.[0].moduleId).toBe('visual')
    }
  })
  it.each([
    { variable: '--loom-ui-scale', min: 0.8, max: 1.25, default: 1, unit: '' },
    { variable: '--loom-canvas-width', min: 600, max: 1000, default: 760, unit: 'px' },
    { variable: '--loom-preview-blur', min: 0, max: 32, default: 12, unit: 'px' },
    { variable: '--loom-preview-opacity', min: 0, max: 100, default: 80, unit: '%' },
  ])('accepts shared numeric parameter $variable within host bounds', shared => {
    expect(() => parse({ ...theme, parameters: [{ ...number, ...shared }] })).not.toThrow()
  })
  it.each([
    { variable: '--loom-ui-scale', min: 0.8, max: 1.25, default: 1, unit: 'px' },
    { variable: '--loom-ui-scale', type: 'color', default: '#ffffff' },
    { variable: '--loom-canvas-width', min: 480, max: 1120, default: 760, unit: 'px' },
    { variable: '--loom-preview-blur', min: 0, max: 40, default: 12, unit: 'px' },
    { variable: '--loom-preview-opacity', min: 0, max: 100, default: 80, unit: '' },
  ])('rejects shared parameter with wrong type, unit or host range %#', shared => {
    expect(() => parse({ ...theme, parameters: [{ ...number, ...shared }] })).toThrow('host numeric unit and range')
  })
  it.each([
    null, { ...number, default: '16' }, { ...number, default: 30 }, { ...number, min: 30 },
    { ...number, step: 0 }, { ...number, unit: ['px'] }, { ...number, unit: 'px; color:red' }, { ...number, variable: '--other-value' },
    { ...number, variable: '--loom-narrative-anchor-offset' }, { ...number, variable: '--loom-narrative-keyboard-height' },
    { ...number, type: 'color', default: 'red;}body{color:red' },
    { ...number, type: 'color', default: '@import "x"' },
    { ...number, type: 'boolean', default: true, trueValue: '1;', falseValue: '0' },
    { ...number, type: 'select', default: 'a', options: [{ label: 'A', value: 'a;}' }] },
    { ...number, type: 'select', default: 'b', options: [{ label: 'A', value: 'a' }] },
  ])('rejects invalid external parameter input %#', parameter => {
    expect(() => parse({ ...theme, parameters: [parameter] })).toThrow()
  })
})


describe('static background manifest contract', () => {
  const background = { id: 'scene', name: 'Scene', description: 'Scene background', image: './Assets/scene.png' }
  const parseBackgrounds = (backgrounds: unknown, extra = {}) => parseExtensionManifest({ ...base, ...extra, contributes: { backgrounds } })
  it('accepts multiple backgrounds without modules', () => {
    expect(parseBackgrounds([background, { ...background, id: 'other', image: 'other.svg' }]).contributes?.backgrounds).toHaveLength(2)
  })
  it('rejects duplicate identities, malformed lists and Timeline contributions', () => {
    expect(() => parseBackgrounds([background, background])).toThrow('duplicated')
    expect(() => parseBackgrounds({})).toThrow('array')
    expect(() => parseBackgrounds([background], { participation: 'timeline' })).toThrow('Timeline')
    expect(() => parseBackgrounds([{ ...background, name: '' }])).toThrow('name')
  })
  it.each(['../scene.png', 'Assets/../../scene.png', '/scene.png', 'https://a/scene.png', 'scene.png?x', 'scene.png#x', '%2e%2e/scene.png', 'a\\scene.png', 'scene.html', '././scene.png'])('rejects unsafe or unsupported image %s', image => {
    expect(() => parseBackgrounds([{ ...background, image }])).toThrow('image')
  })
})
