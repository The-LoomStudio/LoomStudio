export const COLUMN_SPLITTER_SIZE = 9
export const COLUMN_KEYBOARD_STEP = 16

export type ColumnSizeConstraints = {
  collapsedSize?: number
  maxSize?: number
  minSize: number
  snapThreshold?: number
}

export type ResolvableColumn = ColumnSizeConstraints & {
  fill?: boolean
  shrinkPriority?: number
  size: number
}

export function clampColumnSize(size: number, constraints: ColumnSizeConstraints, availableMaximum = Number.MAX_SAFE_INTEGER): number {
  const minimum = constraints.collapsedSize ?? constraints.minSize
  const maximum = Math.max(constraints.minSize, Math.min(constraints.maxSize ?? Number.MAX_SAFE_INTEGER, availableMaximum))
  if (!Number.isFinite(size)) return Math.min(maximum, constraints.minSize)
  return Math.min(maximum, Math.max(minimum, size))
}

export function commitColumnSize(size: number, constraints: ColumnSizeConstraints, availableMaximum = Number.MAX_SAFE_INTEGER): number {
  const clamped = clampColumnSize(size, constraints, availableMaximum)
  if (constraints.collapsedSize !== undefined && constraints.snapThreshold !== undefined && clamped < constraints.snapThreshold) {
    return constraints.collapsedSize
  }
  return Math.max(constraints.minSize, clamped)
}

export function readColumnMaximum(
  columnIndex: number,
  columnSizes: number[],
  columnMinimums: number[],
  fillColumnIndex: number,
  containerWidth: number,
  splitterSize = COLUMN_SPLITTER_SIZE,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return Number.MAX_SAFE_INTEGER
  const reservedWidth = columnMinimums.reduce((total, minimum, index) => {
    if (index === columnIndex) return total
    return total + (index === fillColumnIndex ? minimum : columnSizes[index] ?? minimum)
  }, splitterSize * Math.max(0, columnSizes.length - 1))
  return Math.max(columnMinimums[columnIndex] ?? 0, containerWidth - reservedWidth)
}

export function resolveColumnSizes(columns: ResolvableColumn[], containerWidth: number, splitterSize = COLUMN_SPLITTER_SIZE): number[] {
  const sizes = columns.map(column => column.fill ? column.minSize : clampColumnSize(column.size, column))
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return sizes

  let overflow = sizes.reduce((total, size) => total + size, splitterSize * Math.max(0, columns.length - 1)) - containerWidth
  if (overflow <= 0) return sizes

  const shrinkableIndexes = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !column.fill)
    .sort((left, right) => (right.column.shrinkPriority ?? 0) - (left.column.shrinkPriority ?? 0))

  for (const { column, index } of shrinkableIndexes) {
    if (overflow <= 0) break
    const floor = column.collapsedSize ?? column.minSize
    const reduction = Math.min(overflow, sizes[index] - floor)
    sizes[index] -= reduction
    overflow -= reduction
    if (
      column.collapsedSize !== undefined
      && column.snapThreshold !== undefined
      && sizes[index] < column.snapThreshold
    ) {
      overflow -= sizes[index] - column.collapsedSize
      sizes[index] = column.collapsedSize
    }
  }

  return sizes
}
