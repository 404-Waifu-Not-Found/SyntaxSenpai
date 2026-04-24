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
