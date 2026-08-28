function spacesPreservingNewlines(value) {
  return value.replace(/[^\n]/gu, ' ')
}

function maskHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?(?:-->|$)/gu, spacesPreservingNewlines)
}

function maskInlineCode(line) {
  const characters = [...line]

  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] !== '`') {
      continue
    }

    let markerLength = 1

    while (characters[index + markerLength] === '`') {
      markerLength += 1
    }

    let closingIndex = index + markerLength

    while (closingIndex < characters.length) {
      if (characters[closingIndex] !== '`') {
        closingIndex += 1
        continue
      }

      let closingLength = 1

      while (characters[closingIndex + closingLength] === '`') {
        closingLength += 1
      }

      if (closingLength === markerLength) {
        for (
          let maskedIndex = index;
          maskedIndex < closingIndex + closingLength;
          maskedIndex += 1
        ) {
          characters[maskedIndex] = ' '
        }

        index = closingIndex + closingLength - 1
        break
      }

      closingIndex += closingLength
    }
  }

  return characters.join('')
}

export function maskMarkdownBlocks(content) {
  const withoutComments = maskHtmlComments(content)
  const lines = withoutComments.match(/.*(?:\n|$)/gu) ?? []
  let fenceMarker = null

  return lines
    .map((line) => {
      const lineWithoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line
      const openingFence = lineWithoutNewline.match(/^\s{0,3}(`{3,}|~{3,})/u)

      if (fenceMarker !== null) {
        const closingFence = lineWithoutNewline.match(/^\s{0,3}(`+|~+)\s*$/u)
        const closesFence =
          closingFence &&
          closingFence[1][0] === fenceMarker[0] &&
          closingFence[1].length >= fenceMarker.length

        if (closesFence) {
          fenceMarker = null
        }

        return spacesPreservingNewlines(line)
      }

      if (openingFence) {
        fenceMarker = openingFence[1]
        return spacesPreservingNewlines(line)
      }

      return line
    })
    .join('')
}

export function parseMarkdownTarget(rawTarget) {
  const trimmed = rawTarget.trim()

  if (trimmed.startsWith('<')) {
    const closingBracket = trimmed.indexOf('>')
    return closingBracket === -1 ? trimmed : trimmed.slice(1, closingBracket)
  }

  return trimmed.split(/\s+/u, 1)[0]
}

export function findMarkdownLinks(content) {
  const blockMaskedContent = maskMarkdownBlocks(content)
  const searchableContent = blockMaskedContent
    .split('\n')
    .map(maskInlineCode)
    .join('\n')
  const links = []

  for (let index = 0; index < searchableContent.length - 1; index += 1) {
    if (
      searchableContent[index] !== ']' ||
      searchableContent[index + 1] !== '('
    ) {
      continue
    }

    const targetStart = index + 2
    let cursor = targetStart
    let depth = 1
    let escaped = false

    while (cursor < searchableContent.length) {
      const character = searchableContent[cursor]

      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '(') {
        depth += 1
      } else if (character === ')') {
        depth -= 1

        if (depth === 0) {
          links.push({
            index,
            rawTarget: content.slice(targetStart, cursor),
          })
          index = cursor
          break
        }
      }

      cursor += 1
    }
  }

  const referenceDefinitionPattern =
    /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gmu

  for (const match of searchableContent.matchAll(referenceDefinitionPattern)) {
    const rawTarget = match[1]
    const targetOffset = match[0].indexOf(rawTarget)

    links.push({
      index: match.index + targetOffset,
      rawTarget: content.slice(
        match.index + targetOffset,
        match.index + targetOffset + rawTarget.length,
      ),
    })
  }

  return links.sort((left, right) => left.index - right.index)
}
