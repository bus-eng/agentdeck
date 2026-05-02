# Release Checklist — Before Making the Repository Public

## Secrets and Credentials

- [ ] Run secret scan: `git grep -n "API_KEY\|SECRET\|TOKEN\|PASSWORD\|PRIVATE_KEY\|sk-" -- agentdeck/`
- [ ] Check `.env` and `.env.local` are NOT tracked by git
- [ ] Verify `sessions.json` and `projects.json` patterns are in `.gitignore`
- [ ] Review git history for accidentally committed secrets
- [ ] Change default passphrase (`agentdeck-dummy`) on first deploy

## Git Health

- [ ] `git status` — working tree clean
- [ ] `git log --oneline -20` — review recent commits
- [ ] No large binary files committed unintentionally
- [ ] `.gitignore` covers all sensitive patterns

## Licensing

- [ ] `LICENSE` contains official AGPLv3 text (no modifications)
- [ ] GitHub detects the license as AGPL-3.0
- [ ] `NOTICE` exists with copyright and trademark notice
- [ ] `package.json` has `"license": "AGPL-3.0-or-later"`
- [ ] SPDX headers present in main source files

## Documentation

- [ ] `README.md` explains the license clearly
- [ ] `TRADEMARKS.md` exists and is referenced from README
- [ ] `CONTRIBUTING.md` explains DCO + AGPL contribution terms
- [ ] `SECURITY.md` has a valid contact email (replace placeholder)
- [ ] `CODE_OF_CONDUCT.md` has a valid contact email (replace placeholder)

## Security

- [ ] `npm audit` — no critical vulnerabilities
- [ ] No personal data in commit history or source
- [ ] No screenshots containing real projects or sensitive data

## Placeholder Check

- [ ] `security@example.com` in SECURITY.md → replaced with real email
- [ ] `conduct@example.com` in CODE_OF_CONDUCT.md → replaced with real email

## Suggested Commands

```bash
# Scan for potential secrets
git grep -n "sk-\|API_KEY\|SECRET\|TOKEN\|PASSWORD\|PRIVATE_KEY" -- agentdeck/ | grep -v node_modules | grep -v ".env.example"

# Check git history for large files
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {print $4, $3}' | sort -k2 -n -r | head -10

# Check npm advisories
npm audit

# Verify working tree
git status
```

## Post-Publication

- [ ] Enable GitHub Security Advisories in repo settings
- [ ] Set up branch protection rules on `main`
- [ ] Confirm license badge renders correctly
- [ ] Test clone + setup from fresh environment
