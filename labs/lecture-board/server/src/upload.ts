/**
 * 上传图片按魔数(文件头字节)识别类型,不看文件名后缀 —— 后缀是客户端随便写的,
 * 把一个 .exe 改名成 .png 上传,老校验(只看 part.filename 的后缀)照样会收(运行问题复查 2026-09-17)。
 * 只认三种(与 protocol.md「1–3 张 png/jpg/webp」一致),认不出就整张图拒收。
 */
export type ImageExt = 'png' | 'jpg' | 'webp'

/** 按文件头字节判断图片类型;认不出返回 undefined */
export function sniffImageExt(bytes: Uint8Array): ImageExt | undefined {
  if (!bytes || bytes.length < 12) return undefined
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  // WEBP: 'RIFF' .... 'WEBP'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return undefined
}
