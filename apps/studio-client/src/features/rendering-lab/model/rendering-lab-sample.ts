import type { Translator } from '../../../shared/i18n/index.js'

export type RenderingLabMode =
  | 'text'
  | 'inline-artifact'
  | 'raw-html'
  | 'iframe-artifact'
  | 'agent-choice'
  | 'agent-iframe'
  | 'new-tab'

export type DisplayPart =
  | { type: 'text'; text: string }
  | { type: 'artifact'; artifactType: string; content: string; renderMode: 'inline' | 'iframe' }
  | { type: 'html'; html: string; trusted: boolean }
  | { type: 'agent-action'; actionId: string; choices: Array<{ id: string; label: string }> }

export type RenderingLabSample = {
  mode: RenderingLabMode
  surface: 'narrative' | 'agent-panel' | 'custom-renderer'
  source: string
  parts: DisplayPart[]
}

export function buildRenderingLabSample(mode: RenderingLabMode, t: Translator): RenderingLabSample {
  const source = readRenderingLabSource(mode, t)

  if (mode === 'inline-artifact') {
    return {
      mode,
      surface: 'narrative',
      source,
      parts: parseCloseupParts(source),
    }
  }

  if (mode === 'raw-html') {
    return {
      mode,
      surface: 'narrative',
      source,
      parts: [{ type: 'html', html: source, trusted: false }],
    }
  }

  if (mode === 'iframe-artifact') {
    return {
      mode,
      surface: 'narrative',
      source,
      parts: [{ type: 'artifact', artifactType: 'html-demo', content: source, renderMode: 'iframe' }],
    }
  }

  if (mode === 'agent-choice') {
    return {
      mode,
      surface: 'agent-panel',
      source,
      parts: [parseChoicePart(source, t)],
    }
  }

  if (mode === 'agent-iframe') {
    return {
      mode,
      surface: 'agent-panel',
      source,
      parts: [{ type: 'artifact', artifactType: 'agent-iframe-card', content: source, renderMode: 'iframe' }],
    }
  }

  if (mode === 'new-tab') {
    return {
      mode,
      surface: 'custom-renderer',
      source,
      parts: [{ type: 'text', text: source }],
    }
  }

  return {
    mode,
    surface: 'narrative',
    source,
    parts: [{ type: 'text', text: source }],
  }
}

function parseCloseupParts(source: string): DisplayPart[] {
  const parts: DisplayPart[] = []
  const pattern = /<特写>([\s\S]*?)<\/特写>|<closeup>([\s\S]*?)<\/closeup>/g
  let cursor = 0

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      parts.push({ type: 'text', text: source.slice(cursor, index).trim() })
    }

    parts.push({
      type: 'artifact',
      artifactType: 'closeup',
      content: (match[1] ?? match[2] ?? '').trim(),
      renderMode: 'inline',
    })
    cursor = index + match[0].length
  }

  if (cursor < source.length) {
    parts.push({ type: 'text', text: source.slice(cursor).trim() })
  }

  return parts.filter(part => part.type !== 'text' || part.text.length > 0)
}

function parseChoicePart(source: string, t: Translator): DisplayPart {
  const content = source
    .replace(/<\/?choice>/g, '')
    .trim()
  const choices = content
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: String.fromCharCode(65 + index),
      label: line.replace(/^[A-D][.)]\s*/, ''),
    }))

  return {
    type: 'agent-action',
    actionId: t('renderingLab.choiceActionId'),
    choices,
  }
}

function readRenderingLabSource(mode: RenderingLabMode, t: Translator): string {
  if (mode === 'inline-artifact') return t('renderingLab.source.inlineArtifact')
  if (mode === 'raw-html') return t('renderingLab.source.rawHtml')
  if (mode === 'iframe-artifact') return buildIframeArtifactSource(t)
  if (mode === 'agent-choice') return t('renderingLab.source.agentChoice')
  if (mode === 'agent-iframe') return buildAgentIframeSource(t)
  if (mode === 'new-tab') return t('renderingLab.source.newTab')
  return t('renderingLab.source.text')
}

function buildIframeArtifactSource(t: Translator): string {
  return `<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;background:#111827;color:white;">
    <main style="padding:14px;">
      <strong>${escapeHtml(t('renderingLab.iframeDemoTitle'))}</strong>
      <p style="line-height:1.5">${escapeHtml(t('renderingLab.iframeDemoBody'))}</p>
      <button onclick="document.body.style.background='#7c2d12'">${escapeHtml(t('renderingLab.iframeDemoButton'))}</button>
    </main>
  </body>
</html>`
}

function buildAgentIframeSource(t: Translator): string {
  return `<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;background:#eef2ff;color:#1e1b4b;">
    <main style="padding:14px;">
      <strong>${escapeHtml(t('renderingLab.agentIframeTitle'))}</strong>
      <p>${escapeHtml(t('renderingLab.agentIframeBody'))}</p>
      <button onclick="parent.postMessage({source:'airp-rendering-lab',type:'agent-iframe',value:'approve'},'*')">${escapeHtml(t('renderingLab.agentIframeApprove'))}</button>
      <button onclick="parent.postMessage({source:'airp-rendering-lab',type:'agent-iframe',value:'reject'},'*')">${escapeHtml(t('renderingLab.agentIframeReject'))}</button>
    </main>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
