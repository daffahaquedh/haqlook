import { readFile } from 'node:fs/promises'

const files = ['src/main.jsx', 'src/seller.jsx', 'src/seller-utils.js']
const forbidden = [
  { pattern: /dangerouslySetInnerHTML/, message: 'raw HTML injection is not allowed in the seller surface' },
  { pattern: /VITE_OPENAI|VITE_.*SERVICE_ROLE/i, message: 'private credentials must not be exposed as VITE variables' },
  { pattern: /\beval\s*\(/, message: 'eval is not allowed' },
]

const failures = []
for (const file of files) {
  const contents = await readFile(file, 'utf8')
  for (const rule of forbidden) if (rule.pattern.test(contents)) failures.push(`${file}: ${rule.message}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Seller safety lint passed for ${files.length} source files.`)
