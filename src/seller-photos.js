export const MAX_PRODUCT_PHOTOS = 10
export const MAX_PRODUCT_PHOTO_BYTES = 8 * 1024 * 1024

export const GALLERY_PICKER_PROPS = Object.freeze({ type: 'file', accept: 'image/*', multiple: true })
export const CAMERA_PICKER_PROPS = Object.freeze({ type: 'file', accept: 'image/*', capture: 'environment' })

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

export function isHeicPhoto(file) {
  const type = String(file?.type || '').toLowerCase()
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase()
  return HEIC_TYPES.has(type) || extension === 'heic' || extension === 'heif'
}

export function isSupportedProductPhoto(file) {
  const type = String(file?.type || '').toLowerCase()
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase()
  return isHeicPhoto(file) || SUPPORTED_TYPES.has(type) || (!type && SUPPORTED_EXTENSIONS.has(extension))
}

export function takeAvailablePhotos(currentCount, selected, limit = MAX_PRODUCT_PHOTOS) {
  const available = Math.max(0, limit - currentCount)
  return {
    files: [...selected].slice(0, available),
    omitted: Math.max(0, selected.length - available),
  }
}

async function convertHeicInBrowser(file) {
  let source
  let imageUrl
  try {
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(file) } catch { /* Try the Safari image decoder next. */ }
    }
    if (!source) {
      imageUrl = URL.createObjectURL(file)
      const image = new Image()
      source = await new Promise((resolve, reject) => {
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('The browser could not decode this HEIC/HEIF photo.'))
        image.src = imageUrl
      })
    }

    const width = source.width || source.naturalWidth
    const height = source.height || source.naturalHeight
    if (!width || !height) throw new Error('The photo has no readable dimensions.')

    // Keep fine stitching, labels, prints, and wear visible while limiting memory and upload size.
    const scale = Math.min(1, 2800 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('The browser could not prepare this photo for upload.')
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('The browser could not convert this photo to JPEG.')
    return jpeg
  } finally {
    source?.close?.()
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }
}

export async function prepareProductPhoto(file, { convertHeic = convertHeicInBrowser, createFile = (blob, name, options) => new File([blob], name, options) } = {}) {
  if (!file || !isSupportedProductPhoto(file)) {
    throw new Error('Format foto tidak didukung. Gunakan JPG/JPEG, PNG, WebP, atau HEIC/HEIF dari iPhone.')
  }
  if (file.size > MAX_PRODUCT_PHOTO_BYTES) throw new Error('Ukuran setiap foto maksimal 8 MB.')
  if (!isHeicPhoto(file)) return file

  let jpeg
  try {
    jpeg = await convertHeic(file)
  } catch {
    throw new Error('Foto HEIC/HEIF ini tidak dapat dibaca Safari. Coba pilih versi JPEG atau ambil foto ulang dengan format kompatibel.')
  }
  if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('Konversi HEIC/HEIF gagal. Pilih foto JPEG atau format gambar lain.')
  if (jpeg.size > MAX_PRODUCT_PHOTO_BYTES) throw new Error('Hasil konversi foto melebihi batas 8 MB. Pilih foto dengan ukuran lebih kecil.')

  const name = String(file.name || 'iphone-photo.heic').replace(/\.(heic|heif)$/i, '')
  return createFile(jpeg, `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() })
}

export function productPhotoExtension(file) {
  const type = String(file?.type || '').toLowerCase()
  const nameExtension = String(file?.name || '').split('.').pop()?.toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (nameExtension === 'png') return 'png'
  if (nameExtension === 'webp') return 'webp'
  return 'jpg'
}
