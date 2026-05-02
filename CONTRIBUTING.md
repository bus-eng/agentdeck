# Contributing to AgentDeck

Thank you for your interest in AgentDeck. This document outlines the
basic rules for contributing to the project.

## License

By contributing to this repository, you agree that your contributions
will be licensed under **GNU Affero General Public License v3 or later**
(AGPL-3.0-or-later). See [LICENSE](LICENSE).

## Developer Certificate of Origin (DCO)

We require that all contributors certify their right to submit code
under the DCO. The full text is in [DCO.txt](DCO.txt).

To accept the DCO, each commit must include a `Signed-off-by` line:

```
git commit -s -m "Your commit message"
```

This line certifies that you have the right to submit the code and
that you understand it will be licensed under AGPL-3.0-or-later.

## Before Submitting a Pull Request

1. Ensure your code follows the project's coding conventions (see
   [AGENTS.md](agentdeck/AGENTS.md)).
2. Run `npm run doctor` to verify your environment is healthy.
3. Run `npm test` to ensure existing tests pass.
4. If you add new functionality, consider adding tests.
5. Do not include secrets, tokens, private keys, or real project data.
6. Make sure your commits are signed off (`git commit -s`).

## What Not to Submit

- Code you do not have the right to distribute.
- Proprietary or confidential material.
- Changes that break the existing UI without prior discussion.
- Large refactors that mix functional changes with style changes.

## Code of Conduct

All contributors must follow our [Code of Conduct](CODE_OF_CONDUCT.md).
