import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertSafeRelative, globMatches } from './bundle-lib.mjs'

const bundleLibraryPath = fileURLToPath(new URL('./bundle-lib.mjs', import.meta.url))

const validConfiguration = {
  name: 'Yuraive Guide',
  description: 'Yuraive content support fixture.',
  capabilities: {
    codeInterpreter: true,
  },
  uploadFiles: [
    'yuraive-user-guide.md',
    'YURAIVE_v1_SPEC.md',
    'PLAYBACK_STATS.md',
    'yuraive-content-support.md',
    'inspect_yuraive.py',
    'edit_yuraive.py',
    'yuraive_json.py',
  ],
  conversationStarters: ['One', 'Two', 'Three', 'Four'],
}

const customManifest = {
  schemaVersion: 1,
  target: 'custom-gpt',
  output: 'dist/yuraive-custom-gpt',
  entries: [
    {
      source: 'ai/custom-gpt/instructions.md',
      destination: 'instructions.md',
    },
    {
      source: 'ai/custom-gpt/configuration.json',
      destination: 'configuration.json',
    },
    {
      source: 'docs/src/content/docs',
      destination: 'yuraive-user-guide.md',
      include: ['**/*.md', '**/*.mdx'],
      concatenate: 'markdown-sources',
    },
    {
      source: 'design/YURAIVE_v1_SPEC.md',
      destination: 'YURAIVE_v1_SPEC.md',
    },
    {
      source: 'design/PLAYBACK_STATS.md',
      destination: 'PLAYBACK_STATS.md',
    },
    {
      source: 'ai/shared/references/content-support.md',
      destination: 'yuraive-content-support.md',
    },
    {
      source: 'ai/shared/scripts/inspect_yuraive.py',
      destination: 'inspect_yuraive.py',
    },
    {
      source: 'ai/shared/scripts/edit_yuraive.py',
      destination: 'edit_yuraive.py',
    },
    {
      source: 'ai/shared/scripts/yuraive_json.py',
      destination: 'yuraive_json.py',
    },
  ],
}

const pythonFixture = `import argparse

argparse.ArgumentParser().parse_args()
`

async function writeFixtureFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

async function writeJson(root, relativePath, value) {
  await writeFixtureFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function createCustomFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yuraive-bundle-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(path.join(root, 'ai/scripts'), { recursive: true })
  await copyFile(bundleLibraryPath, path.join(root, 'ai/scripts/bundle-lib.mjs'))
  await writeJson(root, 'ai/custom-gpt/bundle.json', customManifest)
  await writeJson(root, 'ai/custom-gpt/configuration.json', validConfiguration)
  await writeFixtureFile(root, 'ai/custom-gpt/instructions.md', '# Instructions\n')
  await writeFixtureFile(root, 'docs/src/content/docs/a.md', '# Alpha\n')
  await writeFixtureFile(root, 'docs/src/content/docs/nested/b.mdx', '# Beta')
  await writeFixtureFile(root, 'design/YURAIVE_v1_SPEC.md', '# Specification\n')
  await writeFixtureFile(root, 'design/PLAYBACK_STATS.md', '# Playback stats\n')
  await writeFixtureFile(root, 'ai/shared/references/content-support.md', '# Support\n')
  await writeFixtureFile(root, 'ai/shared/scripts/inspect_yuraive.py', pythonFixture)
  await writeFixtureFile(root, 'ai/shared/scripts/edit_yuraive.py', pythonFixture)
  await writeFixtureFile(root, 'ai/shared/scripts/yuraive_json.py', '# helper\n')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['add', '--all'], { cwd: root })

  const moduleUrl = pathToFileURL(path.join(root, 'ai/scripts/bundle-lib.mjs'))
  moduleUrl.searchParams.set('fixture', path.basename(root))
  const library = await import(moduleUrl.href)
  return { library, root }
}

async function updateManifest(root, transform) {
  const manifest = structuredClone(customManifest)
  transform(manifest)
  await writeJson(root, 'ai/custom-gpt/bundle.json', manifest)
}

test('glob patterns match top-level and nested files', () => {
  assert.equal(globMatches('**/*.md', 'index.md'), true)
  assert.equal(globMatches('**/*.md', 'editor/index.md'), true)
  assert.equal(globMatches('**/*', 'favicon.svg'), true)
  assert.equal(globMatches('**/*', 'images/editor.png'), true)
  assert.equal(globMatches('**/*.md', 'image.png'), false)
})

test('safe relative paths reject traversal and ambiguous separators', () => {
  assert.equal(assertSafeRelative('references/docs/index.mdx'), 'references/docs/index.mdx')
  for (const unsafe of ['../notes/x', '/tmp/x', 'a\\b', 'a//b', './a', 'a\0b']) {
    assert.throws(() => assertSafeRelative(unsafe))
  }
})

test('bundle manifests reject forbidden source and destination segments', async (t) => {
  for (const forbiddenSource of ['notes/secret.md', '.agents/secret.md', 'AGENTS.md']) {
    await t.test(forbiddenSource, async (t) => {
      const { library, root } = await createCustomFixture(t)
      await writeFixtureFile(root, forbiddenSource, 'secret\n')
      execFileSync('git', ['add', '--', forbiddenSource], { cwd: root })
      await updateManifest(root, (manifest) => {
        manifest.entries.push({ source: forbiddenSource, destination: 'secret.md' })
      })

      await assert.rejects(library.resolveBundlePlan('custom-gpt'), /Forbidden source path/)
    })
  }

  await t.test('forbidden destination', async (t) => {
    const { library, root } = await createCustomFixture(t)
    await updateManifest(root, (manifest) => {
      manifest.entries.push({
        source: 'design/YURAIVE_v1_SPEC.md',
        destination: 'notes/YURAIVE_v1_SPEC.md',
      })
    })

    await assert.rejects(library.resolveBundlePlan('custom-gpt'), /Forbidden destination path/)
  })
})

test('bundle planning rejects internal and external source symlinks', async (t) => {
  await t.test('internal symlink', async (t) => {
    const { library, root } = await createCustomFixture(t)
    await symlink('design/YURAIVE_v1_SPEC.md', path.join(root, 'spec-link'))
    execFileSync('git', ['add', '--', 'spec-link'], { cwd: root })
    await updateManifest(root, (manifest) => {
      manifest.entries.push({ source: 'spec-link', destination: 'linked-spec.md' })
    })

    await assert.rejects(library.resolveBundlePlan('custom-gpt'), /Symbolic links are not bundled/)
  })

  await t.test('external symlink', async (t) => {
    const { library, root } = await createCustomFixture(t)
    const external = path.join(path.dirname(root), `${path.basename(root)}-external`)
    await writeFile(external, 'external\n')
    t.after(() => rm(external, { force: true }))
    await symlink(external, path.join(root, 'external-link'))
    execFileSync('git', ['add', '--', 'external-link'], { cwd: root })
    await updateManifest(root, (manifest) => {
      manifest.entries.push({ source: 'external-link', destination: 'external' })
    })

    await assert.rejects(library.resolveBundlePlan('custom-gpt'), /resolves outside the repository/)
  })

  await t.test('internal ancestor symlink', async (t) => {
    const { library, root } = await createCustomFixture(t)
    await rename(path.join(root, 'design'), path.join(root, 'design-real'))
    await symlink('design-real', path.join(root, 'design'))

    await assert.rejects(
      library.resolveBundlePlan('custom-gpt'),
      /Bundle source has a symbolic-link ancestor: design/,
    )
  })
})

test('bundle planning rejects selected files that are not tracked by Git', async (t) => {
  const { library, root } = await createCustomFixture(t)
  await writeFixtureFile(root, 'docs/src/content/docs/untracked.md', '# Untracked\n')

  await assert.rejects(
    library.resolveBundlePlan('custom-gpt'),
    /Bundle source is not tracked by Git: docs\/src\/content\/docs\/untracked\.md/,
  )
})

test('validation rejects symbolic links at and inside the bundle root', async (t) => {
  await t.test('bundle root symlink', async (t) => {
    const { library, root } = await createCustomFixture(t)
    await library.buildBundle('custom-gpt')
    const output = path.join(root, customManifest.output)
    const replacement = path.join(root, 'replacement-output')
    await rm(output, { recursive: true })
    await mkdir(replacement)
    await symlink(replacement, output)

    await assert.rejects(
      library.validateBundle('custom-gpt'),
      /Bundle root cannot be a symbolic link/,
    )
  })

  await t.test('nested symlink', async (t) => {
    const { library, root } = await createCustomFixture(t)
    await library.buildBundle('custom-gpt')
    const output = path.join(root, customManifest.output)
    await symlink(path.join(output, 'instructions.md'), path.join(output, 'linked-instructions.md'))

    await assert.rejects(library.validateBundle('custom-gpt'), /Symbolic link found in bundle/)
  })
})

test('Custom GPT uploadFiles must exactly match the required seven files', async (t) => {
  const variants = [
    ['missing', validConfiguration.uploadFiles.slice(0, -1)],
    [
      'duplicate',
      [...validConfiguration.uploadFiles.slice(0, -1), validConfiguration.uploadFiles[0]],
    ],
    ['unexpected', [...validConfiguration.uploadFiles.slice(0, -1), 'unexpected.md']],
    ['extra', [...validConfiguration.uploadFiles, 'unexpected.md']],
  ]

  for (const [name, uploadFiles] of variants) {
    await t.test(name, async (t) => {
      const { library, root } = await createCustomFixture(t)
      await writeJson(root, 'ai/custom-gpt/configuration.json', {
        ...validConfiguration,
        uploadFiles,
      })
      if (uploadFiles.includes('unexpected.md')) {
        await writeFixtureFile(root, 'ai/shared/references/unexpected.md', 'unexpected\n')
      }

      await assert.rejects(
        library.buildBundle('custom-gpt'),
        /uploadFiles must list the seven required files exactly once/,
      )
    })
  }
})

test('validation rejects extra, missing, and tampered output files', async (t) => {
  const { library, root } = await createCustomFixture(t)
  const output = path.join(root, customManifest.output)

  await library.buildBundle('custom-gpt')
  await writeFixtureFile(output, 'extra.txt', 'extra\n')
  await assert.rejects(
    library.validateBundle('custom-gpt'),
    /File is not allowed by the bundle manifest: extra\.txt/,
  )

  await library.buildBundle('custom-gpt')
  await rm(path.join(output, 'YURAIVE_v1_SPEC.md'))
  await assert.rejects(
    library.validateBundle('custom-gpt'),
    /Missing expected bundle file: YURAIVE_v1_SPEC\.md/,
  )

  await library.buildBundle('custom-gpt')
  await writeFile(path.join(output, 'YURAIVE_v1_SPEC.md'), 'tampered\n')
  await assert.rejects(
    library.validateBundle('custom-gpt'),
    /Bundle file differs from its tracked source: YURAIVE_v1_SPEC\.md/,
  )
})

test('markdown concatenation is deterministic and remains independently validatable', async (t) => {
  const { library, root } = await createCustomFixture(t)
  const plan = await library.buildBundle('custom-gpt')
  const output = path.join(root, customManifest.output)
  const guide = await readFile(path.join(output, 'yuraive-user-guide.md'), 'utf8')

  const alphaStart = '<!-- BEGIN SOURCE: docs/src/content/docs/a.md -->'
  const alphaEnd = '<!-- END SOURCE: docs/src/content/docs/a.md -->'
  const betaStart = '<!-- BEGIN SOURCE: docs/src/content/docs/nested/b.mdx -->'
  const betaEnd = '<!-- END SOURCE: docs/src/content/docs/nested/b.mdx -->'
  assert.match(guide, /^<!-- Generated from tracked Markdown and MDX sources\./)
  assert.ok(guide.indexOf(alphaStart) < guide.indexOf(alphaEnd))
  assert.ok(guide.indexOf(alphaEnd) < guide.indexOf(betaStart))
  assert.ok(guide.indexOf(betaStart) < guide.indexOf(betaEnd))
  assert.match(guide, /# Alpha\n<!-- END SOURCE:/)
  assert.match(guide, /# Beta\n<!-- END SOURCE:/)
  assert.equal(plan.files.filter((file) => file.generatedContent).length, 1)

  const result = await library.validateBundle('custom-gpt', output)
  assert.equal(result.fileCount, 9)
})

test('Custom GPT bundle contains only the nine flat root files without a license', async (t) => {
  const { library, root } = await createCustomFixture(t)
  const plan = await library.buildBundle('custom-gpt')
  const output = path.join(root, customManifest.output)
  const entries = await readdir(output, { withFileTypes: true })

  const expectedFiles = [
    'instructions.md',
    'configuration.json',
    'yuraive-user-guide.md',
    'YURAIVE_v1_SPEC.md',
    'PLAYBACK_STATS.md',
    'yuraive-content-support.md',
    'inspect_yuraive.py',
    'edit_yuraive.py',
    'yuraive_json.py',
  ].sort()

  assert.deepEqual(entries.map((entry) => entry.name).sort(), expectedFiles)
  assert.equal(entries.filter((entry) => entry.isDirectory()).length, 0)
  assert.equal(
    entries.some((entry) => entry.name === 'LICENSE'),
    false,
  )
  assert.equal(plan.files.length, 9)
})
