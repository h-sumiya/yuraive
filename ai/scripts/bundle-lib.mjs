import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))

export const repositoryRoot = path.resolve(scriptsDirectory, '../..')

const targetManifests = new Map([
  ['skill', 'ai/skill/bundle.json'],
  ['custom-gpt', 'ai/custom-gpt/bundle.json'],
])

const targetOutputs = new Map([
  ['skill', 'dist/yuraive-skill'],
  ['custom-gpt', 'dist/yuraive-custom-gpt'],
])

const forbiddenSegments = new Set(['notes', '.agents', 'AGENTS.md'])

function isInside(base, candidate) {
  const relative = path.relative(base, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function assertNoSymbolicLinkAncestors(base, candidate, label) {
  const relative = path.relative(base, candidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return
  }

  let current = base
  const ancestors = relative.split(path.sep).slice(0, -1)
  for (const segment of ancestors) {
    current = path.join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`${label} has a symbolic-link ancestor: ${path.relative(base, current)}`)
    }
  }
}

export function assertSafeRelative(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }

  if (
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  if (path.posix.normalize(value) !== value) {
    throw new Error(`Non-normalized ${label}: ${value}`)
  }

  return value
}

function assertAllowedSource(value) {
  assertSafeRelative(value, 'source path')
  const segments = value.split('/')
  const forbidden = segments.find((segment) => forbiddenSegments.has(segment))
  if (forbidden) {
    throw new Error(`Forbidden source path: ${value}`)
  }
}

function globToRegExp(pattern) {
  if (
    typeof pattern !== 'string' ||
    pattern.length === 0 ||
    pattern.includes('\\') ||
    pattern.startsWith('/') ||
    pattern.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error(`Unsafe include pattern: ${String(pattern)}`)
  }

  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        if (pattern[index + 1] === '/') {
          index += 1
          expression += '(?:.*/)?'
        } else {
          expression += '.*'
        }
      } else {
        expression += '[^/]*'
      }
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  expression += '$'
  return new RegExp(expression)
}

export function globMatches(pattern, relativePath) {
  return globToRegExp(pattern).test(relativePath)
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  return new Set(output.split('\0').filter(Boolean))
}

async function readManifest(target, tracked) {
  const manifestRelative = targetManifests.get(target)
  if (!manifestRelative) {
    throw new Error(`Unknown bundle target: ${target}`)
  }
  if (!tracked.has(manifestRelative)) {
    throw new Error(`Bundle manifest is not tracked by Git: ${manifestRelative}`)
  }

  const manifestPath = path.join(repositoryRoot, manifestRelative)
  await assertNoSymbolicLinkAncestors(repositoryRoot, manifestPath, 'Bundle manifest')
  const manifestInfo = await lstat(manifestPath)
  if (manifestInfo.isSymbolicLink()) {
    throw new Error(`Bundle manifest cannot be a symbolic link: ${manifestRelative}`)
  }
  const resolvedManifestPath = await realpath(manifestPath)
  if (!isInside(repositoryRoot, resolvedManifestPath)) {
    throw new Error(`Bundle manifest resolves outside the repository: ${manifestRelative}`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    manifest.target !== target ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    throw new Error(`Invalid bundle manifest: ${manifestRelative}`)
  }

  assertSafeRelative(manifest.output, 'output path')
  if (manifest.output !== targetOutputs.get(target)) {
    throw new Error(`Unexpected output path for ${target}: ${manifest.output}`)
  }

  return { manifest, manifestPath, manifestRelative }
}

async function walkSourceFiles(rootPath, rootRelative) {
  const files = []

  async function visit(currentPath, relativeFromRoot) {
    const entries = await readdir(currentPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      const relativePath = relativeFromRoot ? `${relativeFromRoot}/${entry.name}` : entry.name
      const repositoryRelative = `${rootRelative}/${relativePath}`

      if (entry.isSymbolicLink()) {
        const resolved = await realpath(absolutePath)
        if (!isInside(repositoryRoot, resolved)) {
          throw new Error(`External symbolic link is forbidden: ${repositoryRelative}`)
        }
        throw new Error(`Symbolic links are not bundled: ${repositoryRelative}`)
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`Only regular files can be bundled: ${repositoryRelative}`)
      }
      files.push({
        absolutePath,
        repositoryRelative,
        relativeFromRoot: relativePath,
      })
    }
  }

  await visit(rootPath, '')
  return files
}

async function resolveEntry(entry, tracked) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Each bundle entry must be an object')
  }
  assertAllowedSource(entry.source)
  assertSafeRelative(entry.destination, 'destination path')

  const sourcePath = path.join(repositoryRoot, entry.source)
  if (!isInside(repositoryRoot, sourcePath)) {
    throw new Error(`Bundle source escapes the repository: ${entry.source}`)
  }
  await assertNoSymbolicLinkAncestors(repositoryRoot, sourcePath, 'Bundle source')
  const resolvedSourcePath = await realpath(sourcePath)
  if (!isInside(repositoryRoot, resolvedSourcePath)) {
    throw new Error(`Bundle source resolves outside the repository: ${entry.source}`)
  }

  const sourceInfo = await lstat(sourcePath)
  if (sourceInfo.isSymbolicLink()) {
    const resolved = await realpath(sourcePath)
    if (!isInside(repositoryRoot, resolved)) {
      throw new Error(`External symbolic link is forbidden: ${entry.source}`)
    }
    throw new Error(`Symbolic links are not bundled: ${entry.source}`)
  }

  if (sourceInfo.isFile()) {
    if (entry.include !== undefined || entry.concatenate !== undefined) {
      throw new Error(`File entries cannot define include or concatenate: ${entry.source}`)
    }
    if (!tracked.has(entry.source)) {
      throw new Error(`Bundle source is not tracked by Git: ${entry.source}`)
    }
    return [
      {
        sourceAbsolute: sourcePath,
        sourceRelative: entry.source,
        destinationRelative: entry.destination,
        mode: sourceInfo.mode,
      },
    ]
  }

  if (!sourceInfo.isDirectory()) {
    throw new Error(`Only regular files and directories can be bundle sources: ${entry.source}`)
  }
  if (!Array.isArray(entry.include) || entry.include.length === 0) {
    throw new Error(`Directory entries require an explicit include list: ${entry.source}`)
  }

  const patterns = entry.include.map(globToRegExp)
  const candidates = await walkSourceFiles(sourcePath, entry.source)
  const selected = candidates.filter((candidate) =>
    patterns.some((pattern) => pattern.test(candidate.relativeFromRoot)),
  )
  if (selected.length === 0) {
    throw new Error(`Bundle entry matched no files: ${entry.source}`)
  }
  for (const candidate of selected) {
    assertAllowedSource(candidate.repositoryRelative)
    if (!tracked.has(candidate.repositoryRelative)) {
      throw new Error(`Bundle source is not tracked by Git: ${candidate.repositoryRelative}`)
    }
  }

  if (entry.concatenate !== undefined) {
    if (entry.concatenate !== 'markdown-sources') {
      throw new Error(`Unknown concatenate mode: ${entry.concatenate}`)
    }
    if (
      selected.some(
        (candidate) =>
          !candidate.relativeFromRoot.endsWith('.md') &&
          !candidate.relativeFromRoot.endsWith('.mdx'),
      )
    ) {
      throw new Error('markdown-sources can contain only .md and .mdx files')
    }
    const chunks = [
      '<!-- Generated from tracked Markdown and MDX sources. Do not edit this bundle file. -->\n',
    ]
    for (const candidate of selected) {
      const content = await readFile(candidate.absolutePath, 'utf8')
      chunks.push(
        `\n<!-- BEGIN SOURCE: ${candidate.repositoryRelative} -->\n`,
        content,
        content.endsWith('\n') ? '' : '\n',
        `<!-- END SOURCE: ${candidate.repositoryRelative} -->\n`,
      )
    }
    return [
      {
        generatedContent: Buffer.from(chunks.join(''), 'utf8'),
        sourceRelative: selected.map((candidate) => candidate.repositoryRelative).join(', '),
        destinationRelative: entry.destination,
        mode: 0o644,
      },
    ]
  }

  return Promise.all(
    selected.map(async (candidate) => {
      const info = await stat(candidate.absolutePath)
      return {
        sourceAbsolute: candidate.absolutePath,
        sourceRelative: candidate.repositoryRelative,
        destinationRelative: path.posix.join(entry.destination, candidate.relativeFromRoot),
        mode: info.mode,
      }
    }),
  )
}

export async function resolveBundlePlan(target) {
  const tracked = trackedFiles()
  const { manifest, manifestPath, manifestRelative } = await readManifest(target, tracked)
  const outputPath = path.join(repositoryRoot, manifest.output)
  const distRoot = path.join(repositoryRoot, 'dist')
  if (!isInside(distRoot, outputPath)) {
    throw new Error(`Bundle output escapes dist/: ${manifest.output}`)
  }

  const files = []
  for (const entry of manifest.entries) {
    files.push(...(await resolveEntry(entry, tracked)))
  }

  const destinations = new Map()
  for (const file of files) {
    assertSafeRelative(file.destinationRelative, 'resolved destination')
    if (file.destinationRelative.split('/').some((segment) => forbiddenSegments.has(segment))) {
      throw new Error(`Forbidden destination path: ${file.destinationRelative}`)
    }
    const key = file.destinationRelative.toLocaleLowerCase('en-US')
    if (destinations.has(key)) {
      throw new Error(
        `${file.destinationRelative} collides with ${destinations.get(key)} in the bundle`,
      )
    }
    destinations.set(key, file.destinationRelative)
  }

  files.sort((left, right) =>
    left.destinationRelative.localeCompare(right.destinationRelative, 'en'),
  )
  return {
    target,
    manifest,
    manifestPath,
    manifestRelative,
    outputPath,
    files,
  }
}

async function sha256(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function expectedSha256(file) {
  if (file.generatedContent) {
    return createHash('sha256').update(file.generatedContent).digest('hex')
  }
  return sha256(file.sourceAbsolute)
}

async function walkOutput(rootPath) {
  const files = []

  async function visit(currentPath, relativeFromRoot) {
    const entries = await readdir(currentPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const relativePath = relativeFromRoot ? `${relativeFromRoot}/${entry.name}` : entry.name
      const segments = relativePath.split('/')
      if (segments.some((segment) => forbiddenSegments.has(segment))) {
        throw new Error(`Forbidden path found in bundle: ${relativePath}`)
      }
      const absolutePath = path.join(currentPath, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic link found in bundle: ${relativePath}`)
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath })
      } else {
        throw new Error(`Non-regular entry found in bundle: ${relativePath}`)
      }
    }
  }

  await visit(rootPath, '')
  return files
}

async function requirePath(rootPath, relativePath, kind = 'file') {
  const targetPath = path.join(rootPath, relativePath)
  let info
  try {
    info = await stat(targetPath)
  } catch {
    throw new Error(`Missing required bundle ${kind}: ${relativePath}`)
  }
  if (kind === 'file' && !info.isFile()) {
    throw new Error(`Required bundle path is not a file: ${relativePath}`)
  }
  if (kind === 'directory' && !info.isDirectory()) {
    throw new Error(`Required bundle path is not a directory: ${relativePath}`)
  }
}

async function validateOperationalReferences(rootPath, relativePath) {
  const content = await readFile(path.join(rootPath, relativePath), 'utf8')
  if (content.includes('TODO') || content.includes('[TODO')) {
    throw new Error(`Unresolved TODO found in ${relativePath}`)
  }

  const referencePattern = /`((?:(?:references|knowledge|scripts)\/)[^`\n*]+)`/g
  for (const match of content.matchAll(referencePattern)) {
    const referenced = match[1].replace(/[.,:;)]$/u, '')
    assertSafeRelative(referenced.replace(/\/$/, ''), 'operational reference')
    const referencedPath = path.join(rootPath, referenced)
    try {
      await stat(referencedPath)
    } catch {
      throw new Error(`Broken operational reference in ${relativePath}: ${referenced}`)
    }
  }
}

function validateSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]+?)\n---\n/)
  if (!match) {
    throw new Error('SKILL.md must start with YAML frontmatter')
  }
  const keys = match[1]
    .split('\n')
    .filter((line) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')))
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'description') {
    throw new Error('SKILL.md frontmatter must contain only name and description')
  }
  if (!/^name: yuraive-skill$/m.test(match[1])) {
    throw new Error('SKILL.md has an invalid skill name')
  }
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]
  if (!description || description.length < 40) {
    throw new Error('SKILL.md needs a specific trigger description')
  }
}

async function validateTargetStructure(target, rootPath) {
  if (target === 'skill') {
    await requirePath(rootPath, 'LICENSE')
    await requirePath(rootPath, 'scripts/inspect_yuraive.py')
    await requirePath(rootPath, 'scripts/edit_yuraive.py')
    await requirePath(rootPath, 'SKILL.md')
    await requirePath(rootPath, 'agents/openai.yaml')
    await requirePath(rootPath, 'references/docs', 'directory')
    await requirePath(rootPath, 'references/design/YURAIVE_v1_SPEC.md')
    await requirePath(rootPath, 'references/design/PLAYBACK_STATS.md')
    await requirePath(rootPath, 'references/ai/content-support.md')
    const skill = await readFile(path.join(rootPath, 'SKILL.md'), 'utf8')
    validateSkillFrontmatter(skill)
    const agentMetadata = await readFile(path.join(rootPath, 'agents/openai.yaml'), 'utf8')
    if (
      !agentMetadata.includes('display_name:') ||
      !agentMetadata.includes('short_description:') ||
      !agentMetadata.includes('$yuraive-skill')
    ) {
      throw new Error('agents/openai.yaml is incomplete or stale')
    }
    await validateOperationalReferences(rootPath, 'SKILL.md')
  } else if (target === 'custom-gpt') {
    await requirePath(rootPath, 'instructions.md')
    await requirePath(rootPath, 'configuration.json')
    await requirePath(rootPath, 'yuraive-user-guide.md')
    await requirePath(rootPath, 'YURAIVE_v1_SPEC.md')
    await requirePath(rootPath, 'PLAYBACK_STATS.md')
    await requirePath(rootPath, 'yuraive-content-support.md')
    await requirePath(rootPath, 'inspect_yuraive.py')
    await requirePath(rootPath, 'edit_yuraive.py')
    await requirePath(rootPath, 'yuraive_json.py')
    const configuration = JSON.parse(
      await readFile(path.join(rootPath, 'configuration.json'), 'utf8'),
    )
    if (
      typeof configuration.name !== 'string' ||
      typeof configuration.description !== 'string' ||
      configuration.capabilities?.codeInterpreter !== true ||
      !Array.isArray(configuration.uploadFiles) ||
      configuration.uploadFiles.length === 0 ||
      configuration.uploadFiles.length > 20 ||
      !Array.isArray(configuration.conversationStarters) ||
      configuration.conversationStarters.length < 4
    ) {
      throw new Error('Custom GPT configuration is incomplete')
    }
    const requiredUploads = new Set([
      'yuraive-user-guide.md',
      'YURAIVE_v1_SPEC.md',
      'PLAYBACK_STATS.md',
      'yuraive-content-support.md',
      'inspect_yuraive.py',
      'edit_yuraive.py',
      'yuraive_json.py',
    ])
    if (
      new Set(configuration.uploadFiles).size !== configuration.uploadFiles.length ||
      configuration.uploadFiles.length !== requiredUploads.size ||
      configuration.uploadFiles.some((uploadFile) => !requiredUploads.has(uploadFile))
    ) {
      throw new Error('Custom GPT uploadFiles must list the seven required files exactly once')
    }
    const uploadBasenames = configuration.uploadFiles.map((uploadFile) =>
      path.posix.basename(uploadFile),
    )
    if (new Set(uploadBasenames).size !== uploadBasenames.length) {
      throw new Error('Custom GPT upload file basenames must be unique')
    }
    for (const uploadFile of configuration.uploadFiles) {
      assertSafeRelative(uploadFile, 'Custom GPT upload file')
      await requirePath(rootPath, uploadFile)
    }
    const requiredDistributionFiles = new Set([
      'instructions.md',
      'configuration.json',
      ...requiredUploads,
    ])
    const distributionEntries = await readdir(rootPath, { withFileTypes: true })
    if (
      distributionEntries.length !== requiredDistributionFiles.size ||
      distributionEntries.some(
        (entry) => !entry.isFile() || !requiredDistributionFiles.has(entry.name),
      )
    ) {
      throw new Error('Custom GPT bundle must contain only the nine flat distribution files')
    }
    await validateOperationalReferences(rootPath, 'instructions.md')
  } else {
    throw new Error(`Unknown bundle target: ${target}`)
  }

  const scriptDirectory = target === 'skill' ? path.join(rootPath, 'scripts') : rootPath
  for (const scriptName of ['inspect_yuraive.py', 'edit_yuraive.py']) {
    const result = spawnSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [path.join(scriptDirectory, scriptName), '--help'],
      {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    )
    if (result.status !== 0) {
      throw new Error(`${scriptName} --help failed: ${result.stderr || result.stdout}`)
    }
  }
}

export async function buildBundle(target) {
  const plan = await resolveBundlePlan(target)
  const distRoot = path.join(repositoryRoot, 'dist')
  try {
    const distInfo = await lstat(distRoot)
    if (distInfo.isSymbolicLink() || !distInfo.isDirectory()) {
      throw new Error('dist/ must be a real directory before bundling')
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'ENOENT') {
      throw error
    }
  }
  try {
    const outputInfo = await lstat(plan.outputPath)
    if (outputInfo.isSymbolicLink()) {
      throw new Error(`Refusing to replace symbolic link: ${plan.manifest.output}`)
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'ENOENT') {
      throw error
    }
  }
  await rm(plan.outputPath, { recursive: true, force: true })
  await mkdir(plan.outputPath, { recursive: true })

  for (const file of plan.files) {
    const destinationPath = path.join(plan.outputPath, file.destinationRelative)
    await mkdir(path.dirname(destinationPath), { recursive: true })
    if (file.generatedContent) {
      await writeFile(destinationPath, file.generatedContent)
    } else {
      await copyFile(file.sourceAbsolute, destinationPath)
    }
    await chmod(destinationPath, file.mode & 0o111 ? 0o755 : 0o644)
  }

  await validateBundle(target, plan.outputPath)
  return plan
}

export async function validateBundle(target, requestedPath) {
  const plan = await resolveBundlePlan(target)
  const rootPath = requestedPath ? path.resolve(repositoryRoot, requestedPath) : plan.outputPath
  const rootInfo = await lstat(rootPath)
  if (rootInfo.isSymbolicLink()) {
    throw new Error(`Bundle root cannot be a symbolic link: ${rootPath}`)
  }
  const info = await stat(rootPath)
  if (!info.isDirectory()) {
    throw new Error(`Bundle path is not a directory: ${rootPath}`)
  }

  const actualFiles = await walkOutput(rootPath)
  const expectedByDestination = new Map(plan.files.map((file) => [file.destinationRelative, file]))
  const actualByDestination = new Map(actualFiles.map((file) => [file.relativePath, file]))

  for (const [destination, expected] of expectedByDestination) {
    const actual = actualByDestination.get(destination)
    if (!actual) {
      throw new Error(`Missing expected bundle file: ${destination}`)
    }
    if ((await expectedSha256(expected)) !== (await sha256(actual.absolutePath))) {
      throw new Error(`Bundle file differs from its tracked source: ${destination}`)
    }
  }
  for (const destination of actualByDestination.keys()) {
    if (!expectedByDestination.has(destination)) {
      throw new Error(`File is not allowed by the bundle manifest: ${destination}`)
    }
  }

  await validateTargetStructure(target, rootPath)
  return {
    target,
    rootPath,
    fileCount: actualFiles.length,
  }
}

export function knownTargets() {
  return [...targetManifests.keys()]
}
