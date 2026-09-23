import { strFromU8 } from 'fflate'

// Reads integrity metadata only; decompression and streaming byte budgets remain owned by fflate.
export function readZipChecksums(source: Uint8Array, maximumEntries: number): Map<string, number> {
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength)
  const invalid = () => new Error('Invalid ZIP central directory')
  let end = bytes.length - 22
  const minimum = Math.max(0, end - 65535)
  for (; end >= minimum; end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break
  }
  if (end < minimum || end < 0) throw invalid()
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw invalid()
  let count = bytes.readUInt16LE(end + 10)
  let length = bytes.readUInt32LE(end + 12)
  let start = bytes.readUInt32LE(end + 16)
  let directoryEnd = end
  const read64 = (offset: number) => {
    if (offset < 0 || offset + 8 > bytes.length) throw invalid()
    const value = bytes.readBigUInt64LE(offset)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid()
    return Number(value)
  }
  if (count === 0xffff || length === 0xffffffff || start === 0xffffffff) {
    const locator = end - 20
    if (locator < 0 || bytes.readUInt32LE(locator) !== 0x07064b50
      || bytes.readUInt32LE(locator + 4) !== 0 || bytes.readUInt32LE(locator + 16) !== 1) throw invalid()
    const record = read64(locator + 8)
    if (record + 56 > locator || bytes.readUInt32LE(record) !== 0x06064b50
      || record + 12 + read64(record + 4) !== locator
      || bytes.readUInt32LE(record + 16) !== 0 || bytes.readUInt32LE(record + 20) !== 0) throw invalid()
    count = read64(record + 32)
    if (read64(record + 24) !== count) throw invalid()
    length = read64(record + 40)
    start = read64(record + 48)
    directoryEnd = record
  } else if (bytes.readUInt16LE(end + 8) !== count) throw invalid()
  if (count > maximumEntries) throw new Error(`Loom Card package exceeds ${maximumEntries} entries`)
  if (start + length !== directoryEnd) throw invalid()
  const checksums = new Map<string, number>()
  let offset = start
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalid()
    const flags = bytes.readUInt16LE(offset + 8)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const next = offset + 46 + nameLength + extraLength + bytes.readUInt16LE(offset + 32)
    if (next > directoryEnd || bytes.readUInt16LE(offset + 34) !== 0) throw invalid()
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength), !(flags & 2048))
    if (checksums.has(name)) throw new Error(`Duplicate ZIP entry path: ${name}`)
    const checksum = bytes.readUInt32LE(offset + 16)
    let compressedSize = bytes.readUInt32LE(offset + 20)
    let localOffset = bytes.readUInt32LE(offset + 42)
    if (localOffset === 0xffffffff || compressedSize === 0xffffffff) {
      const extraEnd = offset + 46 + nameLength + extraLength
      let extra = offset + 46 + nameLength
      let found = false
      while (extra + 4 <= extraEnd) {
        const size = bytes.readUInt16LE(extra + 2)
        if (extra + 4 + size > extraEnd) throw invalid()
        if (bytes.readUInt16LE(extra) === 1) {
          let position = extra + 4 + (bytes.readUInt32LE(offset + 24) === 0xffffffff ? 8 : 0)
          if (compressedSize === 0xffffffff) {
            if (position + 8 > extra + 4 + size) throw invalid()
            compressedSize = read64(position)
            position += 8
          }
          if (localOffset === 0xffffffff) {
            if (position + 8 > extra + 4 + size) throw invalid()
            localOffset = read64(position)
          }
          found = true
          break
        }
        extra += 4 + size
      }
      if (!found) throw invalid()
    }
    if (localOffset + 30 > start || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw invalid()
    const localFlags = bytes.readUInt16LE(localOffset + 6)
    if (localFlags !== flags) throw invalid()
    if (!(flags & 8) && bytes.readUInt32LE(localOffset + 14) !== checksum) {
      throw new Error(`ZIP checksum header mismatch: ${name}`)
    }
    if (flags & 8) {
      const dataEnd = localOffset + 30 + bytes.readUInt16LE(localOffset + 26)
        + bytes.readUInt16LE(localOffset + 28) + compressedSize
      if (dataEnd + 4 > start) throw invalid()
      const checksumOffset = dataEnd + (bytes.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0)
      if (checksumOffset + 4 > start || bytes.readUInt32LE(checksumOffset) !== checksum) {
        throw new Error(`ZIP checksum descriptor mismatch: ${name}`)
      }
    }
    checksums.set(name, checksum)
    offset = next
  }
  if (offset !== directoryEnd) throw invalid()
  return checksums
}
