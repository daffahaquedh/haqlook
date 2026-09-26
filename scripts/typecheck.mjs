import { transform } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

for (const entryPoint of ['src/main.jsx', 'src/seller.jsx', 'src/hunter.jsx', 'src/listing-generator.jsx']) {
  const filePath = fileURLToPath(new URL(`../${entryPoint}`, import.meta.url))
  await transform(await readFile(filePath, 'utf8'), { loader: 'jsx', format: 'esm', sourcefile: filePath, logLevel: 'error' })
}

console.log('JSX syntax/type surface check passed (JavaScript project; no TypeScript declarations).')

