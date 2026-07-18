#!/usr/bin/env node

import { knownTargets, validateBundle } from './bundle-lib.mjs'

function usage() {
  return [
    'Usage: node ai/scripts/validate-bundle.mjs <skill|custom-gpt> [bundle-directory]',
    '',
    'Validates bundle contents against the target allow-list and tracked sources.',
  ].join('\n')
}

const [target, bundlePath] = process.argv.slice(2)
if (!target || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage())
  process.exit(target ? 0 : 2)
}
if (!knownTargets().includes(target)) {
  console.error(`Unknown bundle target: ${target}`)
  console.error(usage())
  process.exit(2)
}

try {
  const result = await validateBundle(target, bundlePath)
  console.log(`Valid ${result.target} bundle: ${result.fileCount} files in ${result.rootPath}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
