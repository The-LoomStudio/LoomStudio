export function readYamlScalarTokenClass(value: string) {
  if (/^(?:true|false)$/i.test(value)) return 'constant'
  if (/^(?:null|~)$/i.test(value)) return 'constant'
  // ponytail: Lezer exposes plain YAML scalars only as Literal; remove this fallback if it adds semantic value tags.
  if (/^[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]+)(?:e[+-]?\d+)?$/i.test(value)) return 'number'
  return 'string'
}
