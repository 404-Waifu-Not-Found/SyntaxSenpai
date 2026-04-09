# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| latest `main` | Yes |
| older releases | No |

SyntaxSenpai is currently in **alpha**. Security fixes are applied to the latest code on `main`.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Instead, please report them privately:

1. **Email:** Send details to **syntaxsenpai@proton.me** with the subject line `[SECURITY] <short description>`.
2. **GitHub Security Advisories:** You can also use [GitHub's private vulnerability reporting](https://github.com/404-Waifu-Not-Found/SyntaxSenpai/security/advisories/new).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to expect

- **Acknowledgement** within 48 hours.
- We will work with you to understand and validate the report.
- A fix will be developed privately and released as soon as it is ready.
- You will be credited in the release notes (unless you prefer to remain anonymous).

## Security Best Practices for Contributors

- **Never commit API keys, tokens, or secrets.** Use the in-app settings panel or `.env.local` (gitignored).
- Keep dependencies up to date — run `pnpm audit` regularly.
- Follow the principle of least privilege when adding new agent tool capabilities.
- Sanitize all user input, especially in agent mode where commands may be executed.

## Scope

This policy covers the SyntaxSenpai codebase and its official distribution channels. Third-party integrations and AI provider APIs are outside the scope of this policy — report those to their respective maintainers.
