/**
 * github-api plugin — minimal read-only GitHub integration.
 *
 * Reads the token from process.env.GITHUB_TOKEN (or GH_TOKEN). Tools:
 *   - gh_list_issues(owner, repo, state?)
 *   - gh_get_issue(owner, repo, number)
 *   - gh_list_prs(owner, repo, state?)
 *
 * Intentionally read-only — adding write endpoints should be a separate
 * opt-in plugin so users can't accidentally let the agent post comments.
 */

'use strict'

const API = 'https://api.github.com'

function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

async function gh(endpoint, { method = 'GET' } = {}) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      'User-Agent': 'SyntaxSenpai-github-api/0.1.0',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {})
    }
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* leave json null */
  }
  if (!response.ok) {
    const message = json && json.message ? json.message : text.slice(0, 300)
    throw new Error(`GitHub ${response.status}: ${message}`)
  }
  return json
}

function validateSlug(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

function summarizeIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: issue.user && issue.user.login,
    url: issue.html_url,
    createdAt: issue.created_at,
    labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  }
}

module.exports = {
  activate({ registerTool }) {
    registerTool({
      definition: {
        name: 'gh_list_issues',
        description: 'List issues in a GitHub repository. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repo owner/org' },
            repo: { type: 'string', description: 'Repo name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default: open' },
            limit: { type: 'number', description: '1-30; default 10' }
          },
          required: ['owner', 'repo']
        }
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        try {
          validateSlug(input.owner, 'owner')
          validateSlug(input.repo, 'repo')
          const state = input.state || 'open'
          const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30)
          const issues = await gh(`/repos/${input.owner}/${input.repo}/issues?state=${state}&per_page=${limit}`)
          // GitHub returns PRs in the issues list too — filter them out.
          const onlyIssues = (issues || []).filter((i) => !i.pull_request).map(summarizeIssue)
          return {
            success: true,
            data: { issues: onlyIssues, count: onlyIssues.length },
            displayText: `${input.owner}/${input.repo}: ${onlyIssues.length} ${state} issue(s)`
          }
        } catch (err) {
          return { success: false, error: err && err.message ? err.message : String(err) }
        }
      }
    })

    registerTool({
      definition: {
        name: 'gh_get_issue',
        description: 'Read a single GitHub issue by number. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            number: { type: 'number' }
          },
          required: ['owner', 'repo', 'number']
        }
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        try {
          validateSlug(input.owner, 'owner')
          validateSlug(input.repo, 'repo')
          const n = Math.floor(Number(input.number))
          if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid issue number')
          const issue = await gh(`/repos/${input.owner}/${input.repo}/issues/${n}`)
          return {
            success: true,
            data: {
              ...summarizeIssue(issue),
              body: (issue.body || '').slice(0, 4000)
            },
            displayText: `#${issue.number} ${issue.title} (${issue.state})`
          }
        } catch (err) {
          return { success: false, error: err && err.message ? err.message : String(err) }
        }
      }
    })

    registerTool({
      definition: {
        name: 'gh_list_prs',
        description: 'List pull requests in a GitHub repository. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default: open' },
            limit: { type: 'number', description: '1-30; default 10' }
          },
          required: ['owner', 'repo']
        }
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        try {
          validateSlug(input.owner, 'owner')
          validateSlug(input.repo, 'repo')
          const state = input.state || 'open'
          const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30)
          const prs = await gh(`/repos/${input.owner}/${input.repo}/pulls?state=${state}&per_page=${limit}`)
          const simplified = (prs || []).map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            merged: pr.merged,
            user: pr.user && pr.user.login,
            url: pr.html_url,
            draft: pr.draft
          }))
          return {
            success: true,
            data: { pulls: simplified, count: simplified.length },
            displayText: `${input.owner}/${input.repo}: ${simplified.length} ${state} PR(s)`
          }
        } catch (err) {
          return { success: false, error: err && err.message ? err.message : String(err) }
        }
      }
    })
  }
}
