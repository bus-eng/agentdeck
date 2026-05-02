# Licensing Model

## AgentDeck Community Edition

The Community Edition of AgentDeck is licensed under the
**GNU Affero General Public License v3 or later** (AGPL-3.0-or-later).

### What AGPL Covers

- All source code in the `agentdeck/` directory.
- Scripts, configuration, and documentation files that are part of
  the project.
- Any derivative work or modified version of the Community Edition.

### What AGPL Does NOT Cover

- The **name "AgentDeck"**, logo, icons, visual identity, and branding.
  See [TRADEMARKS.md](../TRADEMARKS.md) for details.
- **Future commercial modules** that may be developed under a separate
  license in a private repository.
- **Third-party dependencies** included via package managers — those
  are governed by their own licenses.

### Key Requirements

If you modify AgentDeck and make it available to users over a network
(as a web service, for example), you **must** provide the corresponding
source code of your modified version under AGPL-3.0-or-later to those
users. This is the core "network copyleft" requirement of the AGPL.

## Separation of Community and Commercial

To maintain a clear boundary:

- All Community code lives in this public repository under AGPL.
- Any future commercial modules will reside in a **separate private
  repository** under a commercial license.
- Commercial modules may interact with the Community Edition through
  well-defined extension points, but the Community code remains
  fully functional on its own.
- Code from the commercial repository must not be copied into the
  Community repository, and vice versa.

This approach follows the standard open-core model used by many
successful open source projects.

## Contributions

By contributing to this repository, you agree that your contributions
will be licensed under AGPL-3.0-or-later. See
[CONTRIBUTING.md](../CONTRIBUTING.md) and [DCO.txt](../DCO.txt) for
details.
