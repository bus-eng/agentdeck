# Security Policy

AgentDeck interacts with local shells, filesystems, and development
workspaces. Security is a priority.

## Reporting a Vulnerability

**Do not report security vulnerabilities as public GitHub issues.**

Instead, use **GitHub Security Advisories** if available, or email:

**TODO: Replace this email before publishing**
**security@example.com**

We will acknowledge receipt within 72 hours and work toward a
resolution.

## What to Include in a Report

- Description of the vulnerability.
- Steps to reproduce.
- Potential impact.
- Any suggested mitigation (optional).

## What NOT to Include

- Real API keys, tokens, or passwords.
- Private keys or certificates.
- Real project data or proprietary code.

## Recommendations for Users

- Do not run AgentDeck with unnecessary privileges (avoid `sudo`).
- Review commands before executing them through the terminal.
- Keep your passphrase private and use a strong one.
- Do not share logs that may contain secrets or API keys.
- Use `AGENTDECK_ALLOW_LAN=true` only on trusted networks.
- Review the `.env` file — never commit it to version control.
