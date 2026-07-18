#!/usr/bin/env node

import { buildBundle, knownTargets } from './bundle-lib.mjs'

function usage() {
  return [
    'Usage: node ai/scripts/bundle.mjs <skill|custom-gpt|all>',
    '',
    'Copies only allow-listed, Git-tracked files into dist/.',
  ].join('\n')
}

const requested = process.argv[2]
if (!requested || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage())
  process.exit(requested ? 0 : 2)
}

const targets = requested === 'all' ? knownTargets() : [requested]
try {
  for (const target of targets) {
    const plan = await buildBundle(target)
    console.log(`Built ${target}: ${plan.files.length} files -> ${plan.manifest.output}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
