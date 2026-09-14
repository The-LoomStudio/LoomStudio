export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export function downloadBase64(base64: string, fileName: string, mediaType: string): void {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  downloadBlob(new Blob([bytes], { type: mediaType }), fileName)
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}
