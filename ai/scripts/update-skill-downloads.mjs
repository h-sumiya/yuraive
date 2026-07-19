import { lstat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [version, ...documents] = process.argv.slice(2)
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

if (!versionPattern.test(version) || documents.length === 0) {
  console.error('Usage: node ai/scripts/update-skill-downloads.mjs <version> <markdown-file>...')
  process.exitCode = 1
} else {
  const repositoryRoot = process.cwd()
  const downloadUrl = `https://github.com/h-sumiya/yuraive/releases/download/skills-v${version}/Yuraive-skill-${version}.zip`
  const downloadPattern =
    /https:\/\/github\.com\/h-sumiya\/yuraive\/releases\/download\/skills-v[0-9]+\.[0-9]+\.[0-9]+\/Yuraive-skill-[0-9]+\.[0-9]+\.[0-9]+\.zip/g
  const labelPattern = /Yuraive Skill [0-9]+\.[0-9]+\.[0-9]+/g

  for (const document of documents) {
    if (
      path.extname(document) !== '.md' ||
      path.isAbsolute(document) ||
      document.includes('\\') ||
      document.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe Markdown path: ${document}`)
    }

    const absolutePath = path.resolve(repositoryRoot, document)
    if (path.relative(repositoryRoot, absolutePath).startsWith('..')) {
      throw new Error(`Markdown path escapes the repository: ${document}`)
    }

    const info = await lstat(absolutePath)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Markdown path must be a regular file: ${document}`)
    }

    const source = await readFile(absolutePath, 'utf8')
    const downloadCount = source.match(downloadPattern)?.length ?? 0
    const labelCount = source.match(labelPattern)?.length ?? 0
    if (downloadCount === 0 || labelCount !== downloadCount) {
      throw new Error(`Invalid Yuraive Skill download links in ${document}`)
    }

    const updated = source
      .replace(downloadPattern, downloadUrl)
      .replace(labelPattern, `Yuraive Skill ${version}`)
    await writeFile(absolutePath, updated)
    console.log(`Updated ${document}: ${downloadCount} download link(s)`)
  }
}
