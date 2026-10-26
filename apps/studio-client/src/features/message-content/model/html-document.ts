import { parse, parseFragment, serialize, defaultTreeAdapter, type DefaultTreeAdapterMap } from 'parse5'
import { boundFrameHeight, observeFrameSize } from '../../../shared/iframe-runtime/frame-size.js'

export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

export function buildHtmlDocument(source: string, token: string): string {
  const document = parse(source)
  function removeNavigation(node: DefaultTreeAdapterMap['parentNode']) {
    for (const child of [...node.childNodes]) {
      if ('tagName' in child && (child.tagName === 'base' || (child.tagName === 'meta'
        && child.attrs.some(attribute => attribute.name === 'http-equiv' && attribute.value.toLowerCase() === 'refresh')))) {
        defaultTreeAdapter.detachNode(child)
      } else if ('childNodes' in child) removeNavigation(child)
    }
  }
  removeNavigation(document)
  const html = document.childNodes.find(node => 'tagName' in node && node.tagName === 'html') as DefaultTreeAdapterMap['element']
  const head = html.childNodes.find(node => 'tagName' in node && node.tagName === 'head') as DefaultTreeAdapterMap['element']
  // Prepend the policy before any user-provided script, meta, or base element.
  const bootstrap = parseFragment(`<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">
<meta name="referrer" content="no-referrer">
<style>:root,html,body{background:transparent !important;margin:0}html{overflow-wrap:anywhere}img,video,canvas,svg{max-width:100%}</style>
<script>
(() => {
  const token = ${JSON.stringify(token).replace(/</g, '\\u003c')};
  const observe = () => (${observeFrameSize.toString()})(height => parent.postMessage({type:'loom-html-height', token, height}, '*'), Infinity);
  // The bootstrap lives in head; measuring while parsing can report an empty
  // body and briefly collapse the host before the real content is available.
  const start = () => requestAnimationFrame(observe);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
</script>`)
  const first = head.childNodes[0]
  for (const child of [...bootstrap.childNodes]) {
    defaultTreeAdapter.detachNode(child)
    if (first) defaultTreeAdapter.insertBefore(head, child, first)
    else defaultTreeAdapter.appendChild(head, child)
  }
  return serialize(document)
}

export function readHtmlHeight(data: unknown, token: string): number | undefined {
  if (!data || typeof data !== 'object') return
  const message = data as Record<string, unknown>
  if (message.type !== 'loom-html-height' || message.token !== token || typeof message.height !== 'number' || !Number.isFinite(message.height)) return
  return boundFrameHeight(message.height, Infinity)
}
