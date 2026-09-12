export type Size = { width: number; height: number }
export type ImageTransform = { scale: number; x: number; y: number }

export function fitImage(image: Size, viewport: Size): ImageTransform {
  return { scale: Math.min(viewport.width / image.width, viewport.height / image.height, 1), x: 0, y: 0 }
}

export function constrainImage(transform: ImageTransform, image: Size, viewport: Size): ImageTransform {
  const x = Math.max(0, (image.width * transform.scale - viewport.width) / 2)
  const y = Math.max(0, (image.height * transform.scale - viewport.height) / 2)
  return { scale: transform.scale, x: Math.max(-x, Math.min(x, transform.x)), y: Math.max(-y, Math.min(y, transform.y)) }
}

export function zoomImage(transform: ImageTransform, scale: number, point: { x: number; y: number }, image: Size, viewport: Size): ImageTransform {
  const ratio = scale / transform.scale
  return constrainImage({ scale, x: point.x - (point.x - transform.x) * ratio, y: point.y - (point.y - transform.y) * ratio }, image, viewport)
}
