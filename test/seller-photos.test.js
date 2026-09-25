import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMERA_PICKER_PROPS,
  GALLERY_PICKER_PROPS,
  MAX_PRODUCT_PHOTO_BYTES,
  MAX_PRODUCT_PHOTOS,
  isHeicPhoto,
  isSupportedProductPhoto,
  prepareProductPhoto,
  productPhotoExtension,
  takeAvailablePhotos,
} from '../src/seller-photos.js'

test('gallery and camera use separate iOS picker configurations', () => {
  assert.deepEqual(GALLERY_PICKER_PROPS, { type: 'file', accept: 'image/*', multiple: true })
  assert.equal(Object.hasOwn(GALLERY_PICKER_PROPS, 'capture'), false)
  assert.deepEqual(CAMERA_PICKER_PROPS, { type: 'file', accept: 'image/*', capture: 'environment' })
})

test('multiple gallery selection respects the ten-photo cap', () => {
  const selected = Array.from({ length: 8 }, (_, index) => ({ name: `${index}.jpg` }))
  const result = takeAvailablePhotos(4, selected)
  assert.equal(MAX_PRODUCT_PHOTOS, 10)
  assert.equal(result.files.length, 6)
  assert.equal(result.omitted, 2)
  assert.deepEqual(takeAvailablePhotos(10, selected), { files: [], omitted: 8 })
})

test('JPG, PNG, WebP, and HEIC/HEIF are recognized safely', () => {
  for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.heic', ''], ['a.heif', 'image/heif']]) {
    assert.equal(isSupportedProductPhoto({ name, type }), true, name)
  }
  assert.equal(isHeicPhoto({ name: 'iphone.HEIC', type: '' }), true)
  assert.equal(isSupportedProductPhoto({ name: 'a.svg', type: 'image/svg+xml' }), false)
})

test('HEIC photos convert to JPEG while originals remain untouched', async () => {
  const source = { name: 'closet.heic', type: 'image/heic', size: 1200, lastModified: 10 }
  const jpeg = new Blob(['converted'], { type: 'image/jpeg' })
  const result = await prepareProductPhoto(source, {
    convertHeic: async (file) => { assert.equal(file, source); return jpeg },
    createFile: (blob, name, options) => ({ blob, name, ...options }),
  })
  assert.equal(source.type, 'image/heic')
  assert.equal(result.name, 'closet.jpg')
  assert.equal(result.type, 'image/jpeg')
  assert.equal(result.blob, jpeg)
})

test('photo size and conversion errors are clear and bounded', async () => {
  await assert.rejects(prepareProductPhoto({ name: 'large.png', type: 'image/png', size: MAX_PRODUCT_PHOTO_BYTES + 1 }), /maksimal 8 MB/)
  await assert.rejects(prepareProductPhoto({ name: 'broken.heic', type: 'image/heic', size: 4 }, { convertHeic: async () => { throw Error('decoder') } }), /tidak dapat dibaca Safari/)
  assert.equal(productPhotoExtension({ name: 'x.webp', type: '' }), 'webp')
  assert.equal(productPhotoExtension({ name: 'x.png', type: 'image/png' }), 'png')
  assert.equal(productPhotoExtension({ name: 'x.jpg', type: 'image/jpeg' }), 'jpg')
})
