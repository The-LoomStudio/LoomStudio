export function readCodeHighlightLanguage(language?: string) {
  switch (language?.toLowerCase()) {
    case 'js': case 'jsx': case 'javascript':
    case 'ts': case 'tsx': case 'typescript': return 'javascript'
    case 'json': case 'jsonc': return 'json'
    case 'yaml': case 'yml': return 'yaml'
    case 'xml': case 'html': return 'xml'
    default: return undefined
  }
}
