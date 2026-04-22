const test = require('node:test')
const assert = require('node:assert/strict')

// Mirrored from apps/desktop/src/main/ipc/terminal.ts — keep in sync.
const DESTRUCTIVE_PATTERNS = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr)\b/, why: 'Recursive forced deletion (rm -rf)' },
  { pattern: /\bsudo\b/, why: 'Privilege escalation (sudo)' },
  { pattern: /\bdoas\b/, why: 'Privilege escalation (doas)' },
  { pattern: /\bsu\s+-/, why: 'Switch user (su -)' },
  { pattern: /\bmkfs[\s.]/, why: 'Filesystem format (mkfs)' },
  { pattern: /\bdd\s+[^\n]*\bof=\/dev\//, why: 'Raw block-device write (dd of=/dev/…)' },
  { pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+[^\n]*--force)/, why: 'Destructive git (reset --hard / clean -f / push --force)' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: 'Fork bomb' },
  { pattern: /\brm\s+-[a-zA-Z]*\s+\/(?:\s|$|\*)/, why: 'rm targeting filesystem root' },
  { pattern: /\bchmod\s+-R\s+[0-7]+\s+\//, why: 'Recursive chmod on filesystem root' },
  { pattern: /\bshred\b/, why: 'Shred (irreversible overwrite)' },
  { pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/, why: 'Power command' },
  { pattern: />\s*\/dev\/sd[a-z]/, why: 'Redirect to raw disk device' },
]

function matchDestructive(command) {
  for (const { pattern, why } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return why
  }
  return null
}

const shouldBlock = [
  ['rm -rf /home/user', 'Recursive forced deletion'],
  ['rm -fr node_modules', 'Recursive forced deletion'],
  ['sudo apt install vim', 'Privilege escalation (sudo)'],
  ['doas pkg install curl', 'Privilege escalation (doas)'],
  ['su - root', 'Switch user (su -)'],
  ['mkfs.ext4 /dev/sdb', 'Filesystem format (mkfs)'],
  ['dd if=/dev/zero of=/dev/sda', 'Raw block-device write'],
  ['git reset --hard HEAD~1', 'Destructive git'],
  ['git clean -fd .', 'Destructive git'],
  ['git push origin main --force', 'Destructive git'],
  [':(){:|:&};:', 'Fork bomb'],
  ['rm -r / --no-preserve-root', 'rm targeting filesystem root'],
  ['chmod -R 777 /', 'Recursive chmod on filesystem root'],
  ['shred -u secret.txt', 'Shred (irreversible overwrite)'],
  ['shutdown -h now', 'Power command'],
  ['reboot', 'Power command'],
  ['halt', 'Power command'],
  ['poweroff', 'Power command'],
  ['cat /etc/passwd > /dev/sda', 'Redirect to raw disk device'],
]

const shouldAllow = [
  'ls -la',
  'pwd',
  'echo hello',
  'cat README.md',
  'git status',
  'git log --oneline',
  'git add .',
  'git commit -m "update"',
  'git push origin main',
  'rm file.txt',
  'rm -r ./dist',
  'rm -r /etc/nginx',
  'chmod 755 script.sh',
  'find . -name "*.ts"',
  'pnpm install',
  'node --version',
  'whoami',
  'date',
]

test('matchDestructive blocks dangerous commands', () => {
  for (const [cmd, expectedReason] of shouldBlock) {
    const result = matchDestructive(cmd)
    assert.ok(result !== null, `Expected '${cmd}' to be blocked`)
    assert.ok(result.includes(expectedReason) || expectedReason.includes(result.split(' ')[0]),
      `Command '${cmd}' blocked with unexpected reason: ${result}`)
  }
})

test('matchDestructive allows safe commands', () => {
  for (const cmd of shouldAllow) {
    const result = matchDestructive(cmd)
    assert.strictEqual(result, null, `Expected '${cmd}' to be allowed, but got: ${result}`)
  }
})

test('matchDestructive handles empty input', () => {
  assert.strictEqual(matchDestructive(''), null)
  assert.strictEqual(matchDestructive('   '), null)
})
