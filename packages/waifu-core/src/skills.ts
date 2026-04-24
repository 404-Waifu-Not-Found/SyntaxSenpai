/**
 * Skills — waifu-authored markdown knowledge packs.
 *
 * A skill is a `SKILL.md` file with minimal YAML frontmatter plus a
 * markdown body. The waifu creates these with `create_skill` when she
 * wants to remember a reusable capability across sessions. She can
 * pull a skill into the next turn's context with `use_skill`.
 *
 * Format:
 *
 *   ---
 *   name: my-skill
 *   description: One-line summary shown to the waifu so she knows when to use it.
 *   ---
 *
 *   Full body of the skill — instructions, examples, anything that
 *   helps the waifu execute the skill on demand.
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface Skill extends SkillFrontmatter {
  body: string;
  /** Slug derived from filesystem path (independent of `name`). */
  slug: string;
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

/**
 * Parse a SKILL.md file into frontmatter + body. Returns null if the
 * file isn't valid — caller can skip or surface an error.
 */
export function parseSkillFile(raw: string, slug: string): Skill | null {
  const match = FRONTMATTER_RE.exec(raw.trim());
  if (!match) return null;

  const frontmatter = parseFrontmatter(match[1]);
  if (!frontmatter) return null;
  if (!frontmatter.name || !frontmatter.description) return null;

  return {
    slug,
    name: frontmatter.name,
    description: frontmatter.description,
    body: (match[2] || '').trim(),
  };
}

function parseFrontmatter(raw: string): SkillFrontmatter | null {
  const out: Partial<SkillFrontmatter> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = stripQuotes(trimmed.slice(idx + 1).trim());
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out.name && out.description ? (out as SkillFrontmatter) : null;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Serialize a skill back to SKILL.md format. Used by the create_skill
 * handler so the waifu's output lands on disk in the same shape the
 * loader expects.
 */
export function serializeSkill(skill: Pick<Skill, 'name' | 'description' | 'body'>): string {
  const safeName = skill.name.replace(/"/g, '\\"');
  const safeDescription = skill.description.replace(/"/g, '\\"');
  return `---\nname: "${safeName}"\ndescription: "${safeDescription}"\n---\n\n${skill.body.trim()}\n`;
}

/**
 * Validates that a skill name is safe to use as a directory slug.
 * Rejects path traversal and anything that could trip the filesystem.
 */
export function isValidSkillSlug(slug: string): boolean {
  if (typeof slug !== 'string' || !slug) return false;
  if (slug.length > 64) return false;
  return /^[a-z0-9][a-z0-9_-]*$/i.test(slug);
}

/**
 * Format available skills as a short block to embed in the system
 * prompt so the waifu knows what skills exist and when to call use_skill.
 */
export function formatSkillsForPrompt(skills: Pick<Skill, 'name' | 'description' | 'slug'>[]): string {
  if (!skills.length) return '';
  const lines = skills.map((s) => `- ${s.slug}: ${s.description}`);
  return `\n\n[Available Skills]
You have these skills available. Call \`use_skill\` with the slug to pull full instructions into the next turn. Prefer using an existing skill over reinventing it.
${lines.join('\n')}`;
}
