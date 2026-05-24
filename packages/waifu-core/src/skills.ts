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

/**
 * Parse a SKILL.md file into frontmatter + body. Returns null if the
 * file isn't valid — caller can skip or surface an error.
 */
export function parseSkillFile(raw: string, slug: string): Skill | null {
  const parsed = splitFrontmatter(raw);
  if (!parsed) return null;

  const frontmatter = parseFrontmatter(parsed.frontmatter);
  if (!frontmatter) return null;
  if (!frontmatter.name || !frontmatter.description) return null;

  return {
    slug,
    name: frontmatter.name,
    description: frontmatter.description,
    body: parsed.body.trim(),
  };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const lines = raw.replace(/^\uFEFF/, '').trimStart().split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      return {
        frontmatter: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
      };
    }
  }
  return null;
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
    if (value.startsWith('"')) {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'string' ? parsed : value.slice(1, -1);
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Serialize a skill back to SKILL.md format. Used by the create_skill
 * handler so the waifu's output lands on disk in the same shape the
 * loader expects.
 */
export function serializeSkill(skill: Pick<Skill, 'name' | 'description' | 'body'>): string {
  return `---\nname: ${quoteYamlString(skill.name)}\ndescription: ${quoteYamlString(skill.description)}\n---\n\n${skill.body.trim()}\n`;
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
