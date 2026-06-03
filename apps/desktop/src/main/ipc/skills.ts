const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

import {
  parseSkillFile,
  serializeSkill,
  isValidSkillSlug,
  type Skill,
} from '@syntax-senpai/waifu-core'
import { mainLogger } from '../logger'

const { ipcMain, app } = electronModule

let registered = false

function skillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

function skillPath(slug: string): string {
  if (!isValidSkillSlug(slug)) throw new Error(`Invalid skill slug: ${slug}`)
  return path.join(skillsDir(), slug, 'SKILL.md')
}

function listSkillsFromDisk(): { skills: Skill[]; errors: Array<{ slug: string; reason: string }> } {
  const dir = skillsDir()
  const skills: Skill[] = []
  const errors: Array<{ slug: string; reason: string }> = []
  if (!fs.existsSync(dir)) return { skills, errors }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    if (!isValidSkillSlug(slug)) {
      errors.push({ slug, reason: 'Invalid slug' })
      continue
    }
    const file = path.join(dir, slug, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = parseSkillFile(raw, slug)
      if (!parsed) {
        errors.push({ slug, reason: 'Missing or malformed frontmatter' })
        continue
      }
      skills.push(parsed)
    } catch (err: any) {
      errors.push({ slug, reason: err?.message || String(err) })
    }
  }
  return { skills, errors }
}

export function listSkillSummaries(): Array<Pick<Skill, 'slug' | 'name' | 'description'>> {
  return listSkillsFromDisk().skills.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
  }))
}

export function readSkillBody(slug: string): Skill | null {
  if (!isValidSkillSlug(slug)) return null
  const file = skillPath(slug)
  if (!fs.existsSync(file)) return null
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return parseSkillFile(raw, slug)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// GitHub skill importer
// ---------------------------------------------------------------------------

const IMPORT_MAX_SKILLS = 300
const IMPORT_MAX_FILES_PER_SKILL = 100
const IMPORT_MAX_FILE_BYTES = 1024 * 1024 // 1 MB per file
const IMPORT_MAX_SKILL_BYTES = 5 * 1024 * 1024 // 5 MB per skill dir

interface ImportSource {
  owner: string
  repo: string
  ref?: string
  subpath: string
}

interface ImportResult {
  installed: string[]
  skipped: Array<{ slug: string; reason: string }>
  errors: Array<{ slug: string; reason: string }>
  ref: string
}

/** Accepts `owner/repo`, `owner/repo/sub/path`, or any github.com URL. */
function parseGithubSource(input: string): ImportSource | null {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (!s) return null
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '')
  s = s.replace(/\.git$/i, '')
  const parts = s.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]
  const repo = parts[1]
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null
  let ref: string | undefined
  let subpath = ''
  if (parts.length > 2) {
    if (parts[2] === 'tree' || parts[2] === 'blob') {
      ref = parts[3]
      subpath = parts.slice(4).join('/')
    } else {
      subpath = parts.slice(2).join('/')
    }
  }
  return { owner, repo, ref, subpath: subpath.replace(/\/+$/, '') }
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'SyntaxSenpai-SkillImporter',
    Accept: 'application/vnd.github+json',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `token ${token}`
  return headers
}

async function resolveRef(src: ImportSource): Promise<string> {
  if (src.ref) return src.ref
  try {
    const res = await fetch(`https://api.github.com/repos/${src.owner}/${src.repo}`, {
      headers: ghHeaders(),
    })
    if (res.ok) {
      const json: any = await res.json()
      if (json?.default_branch) return json.default_branch
    }
  } catch {
    /* fall through to default */
  }
  return 'main'
}

async function fetchTree(
  src: ImportSource,
  ref: string,
): Promise<Array<{ path: string; type: string; size?: number }>> {
  const url = `https://api.github.com/repos/${src.owner}/${src.repo}/git/trees/${encodeURIComponent(
    ref,
  )}?recursive=1`
  const res = await fetch(url, { headers: ghHeaders() })
  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' Rate limited — set a GITHUB_TOKEN env var to raise the limit.'
        : res.status === 404
          ? ' Repo or branch not found.'
          : ''
    throw new Error(`GitHub tree fetch failed (HTTP ${res.status}).${hint}`)
  }
  const json: any = await res.json()
  return Array.isArray(json?.tree) ? json.tree : []
}

function rawUrl(src: ImportSource, ref: string, filePath: string): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(
    ref,
  )}/${encodedPath}`
}

async function fetchRawText(src: ImportSource, ref: string, filePath: string): Promise<string> {
  const res = await fetch(rawUrl(src, ref, filePath), {
    headers: { 'User-Agent': 'SyntaxSenpai-SkillImporter' },
  })
  if (!res.ok) throw new Error(`Failed to download ${filePath} (HTTP ${res.status})`)
  return await res.text()
}

async function fetchRawBuffer(src: ImportSource, ref: string, filePath: string): Promise<Buffer> {
  const res = await fetch(rawUrl(src, ref, filePath), {
    headers: { 'User-Agent': 'SyntaxSenpai-SkillImporter' },
  })
  if (!res.ok) throw new Error(`Failed to download ${filePath} (HTTP ${res.status})`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

function slugifyDir(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

async function importSkillsFromGithub(
  source: string,
  opts: { overwrite?: boolean } = {},
  onProgress?: (msg: string) => void,
): Promise<ImportResult> {
  const src = parseGithubSource(source)
  if (!src) {
    throw new Error('Could not parse a GitHub repo from that input. Use "owner/repo" or a github.com URL.')
  }
  if (typeof fetch !== 'function') {
    throw new Error('Network fetch is unavailable in this runtime.')
  }

  onProgress?.(`Resolving ${src.owner}/${src.repo}…`)
  const ref = await resolveRef(src)
  const tree = await fetchTree(src, ref)

  const prefix = src.subpath ? `${src.subpath}/` : ''
  const skillFiles = tree.filter(
    (t) =>
      t.type === 'blob' &&
      /(^|\/)SKILL\.md$/i.test(t.path) &&
      (!prefix || t.path === `${src.subpath}/SKILL.md` || t.path.startsWith(prefix)),
  )
  if (!skillFiles.length) {
    throw new Error(
      `No SKILL.md files found in ${src.owner}/${src.repo}${
        src.subpath ? `/${src.subpath}` : ''
      } @ ${ref}. (Tip: index repos like VoltAgent/awesome-agent-skills only link out — import the source repo, e.g. VoltAgent/skills.)`,
    )
  }

  const installed: string[] = []
  const skipped: Array<{ slug: string; reason: string }> = []
  const errors: Array<{ slug: string; reason: string }> = []
  const usedSlugs = new Set<string>()

  for (const sf of skillFiles) {
    if (installed.length >= IMPORT_MAX_SKILLS) {
      skipped.push({ slug: sf.path, reason: `Import cap (${IMPORT_MAX_SKILLS}) reached` })
      continue
    }
    const slashIdx = sf.path.lastIndexOf('/')
    const skillDir = slashIdx >= 0 ? sf.path.slice(0, slashIdx) : ''
    const baseName = skillDir ? skillDir.slice(skillDir.lastIndexOf('/') + 1) : src.repo
    const slug = slugifyDir(baseName) || slugifyDir(src.repo)
    if (!slug || !isValidSkillSlug(slug)) {
      errors.push({ slug: baseName, reason: 'Could not derive a valid slug' })
      continue
    }

    // Resolve collisions. With overwrite off, suffix -2, -3, … and never
    // touch an existing folder; with overwrite on, only dedupe within run.
    let finalSlug = slug
    let n = 2
    const existsOnDisk = () => fs.existsSync(path.join(skillsDir(), finalSlug, 'SKILL.md'))
    while (usedSlugs.has(finalSlug) || (!opts.overwrite && existsOnDisk())) {
      finalSlug = `${slug}-${n++}`.slice(0, 64)
      if (n > 50) break
    }

    onProgress?.(`Importing ${finalSlug}…`)
    try {
      // Validate the SKILL.md before writing anything to disk.
      const skillRaw = await fetchRawText(src, ref, sf.path)
      const parsed = parseSkillFile(skillRaw, finalSlug)
      if (!parsed) {
        errors.push({ slug: finalSlug, reason: 'SKILL.md missing name/description frontmatter' })
        continue
      }

      const dirPrefix = skillDir ? `${skillDir}/` : ''
      const files = tree
        .filter((t) =>
          t.type === 'blob' && (skillDir ? t.path.startsWith(dirPrefix) : !t.path.includes('/')),
        )
        .slice(0, IMPORT_MAX_FILES_PER_SKILL)

      const targetDir = path.join(skillsDir(), finalSlug)
      const targetRoot = path.resolve(targetDir)
      fs.mkdirSync(targetDir, { recursive: true })
      let totalBytes = 0
      for (const f of files) {
        const rel = skillDir ? f.path.slice(dirPrefix.length) : f.path
        if (!rel || rel.includes('..')) continue
        if ((f.size || 0) > IMPORT_MAX_FILE_BYTES) continue
        const dest = path.resolve(path.join(targetDir, rel))
        // Path-traversal guard: dest must stay under the skill folder.
        if (dest !== targetRoot && !dest.startsWith(targetRoot + path.sep)) continue
        const buf = await fetchRawBuffer(src, ref, f.path)
        totalBytes += buf.length
        if (totalBytes > IMPORT_MAX_SKILL_BYTES) break
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, buf)
      }
      installed.push(finalSlug)
      usedSlugs.add(finalSlug)
    } catch (err: any) {
      errors.push({ slug: finalSlug, reason: err?.message || String(err) })
    }
  }

  return { installed, skipped, errors, ref }
}

export function registerSkillsIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('skills:list', async () => {
    try {
      return { success: true, ...listSkillsFromDisk() }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('skills:read', async (_e: any, slug: string) => {
    try {
      const skill = readSkillBody(slug)
      if (!skill) return { success: false, error: 'Skill not found' }
      return { success: true, skill }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  // Called by the create_skill agent tool via the existing agent IPC
  // bridge. Returns the path written so the caller can echo it back.
  ipcMain.handle(
    'skills:write',
    async (_e: any, payload: { slug: string; name: string; description: string; body: string }) => {
      try {
        const { slug, name, description, body } = payload || ({} as any)
        if (!isValidSkillSlug(slug)) {
          return { success: false, error: 'slug must be a-z, 0-9, _ or - (no traversal, <= 64 chars)' }
        }
        if (typeof name !== 'string' || !name.trim()) return { success: false, error: 'name is required' }
        if (typeof description !== 'string' || !description.trim()) {
          return { success: false, error: 'description is required' }
        }
        if (typeof body !== 'string' || !body.trim()) return { success: false, error: 'body is required' }

        const file = skillPath(slug)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = file + '.tmp'
        fs.writeFileSync(tmp, serializeSkill({ name, description, body }), 'utf8')
        fs.renameSync(tmp, file)
        mainLogger.info({ slug, file }, 'skill written')
        return { success: true, slug, file }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  // Import one-or-many SKILL.md packs from a public GitHub repo. The
  // waifu's skill folder and external skill collections (VoltAgent,
  // Anthropic, etc.) share the same `SKILL.md` + frontmatter shape, so
  // importing is "find every SKILL.md, copy its whole directory in".
  ipcMain.handle(
    'skills:import',
    async (e: any, payload: { source: string; overwrite?: boolean }) => {
      try {
        const sender = e?.sender
        const onProgress = (msg: string) => {
          try {
            sender?.send('skills:import-progress', msg)
          } catch {
            /* renderer gone */
          }
        }
        const result = await importSkillsFromGithub(
          payload?.source,
          { overwrite: !!payload?.overwrite },
          onProgress,
        )
        mainLogger.info(
          {
            source: payload?.source,
            installed: result.installed.length,
            skipped: result.skipped.length,
            errors: result.errors.length,
          },
          'skills imported',
        )
        return { success: true, ...result }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  ipcMain.handle('skills:delete', async (_e: any, slug: string) => {
    try {
      if (!isValidSkillSlug(slug)) return { success: false, error: 'Invalid slug' }
      const dir = path.dirname(skillPath(slug))
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerSkillsIpc, listSkillSummaries, readSkillBody }

export {}
