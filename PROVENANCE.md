# Provenance and licensing

## Repository source

`extensions/fragments.ts` adapts the maintainer-supplied local fragment extension. `tests/fragments.test.mjs` ports its supplied tests and adds generic fixtures and checks. Workflow-specific configuration and integrations were removed. Examples and repository documentation were newly written for this package; no personal fragment library or session text was copied.

The initial extension and tests were developed with AI assistance for this project’s maintainer and subsequently adapted for public release. They were not supplied by the maintainer as third-party source. The available source had no prior license headers or attribution; inspection identified no vendored third-party implementation. Original project code is offered under MIT at the maintainer’s direction.

This records the known development history, not a guarantee of originality or an exhaustive similarity search. If third-party provenance is identified later, preserve required notices and resolve any licensing requirements; this repository’s MIT license does not override third-party rights.

## Dependencies and reference material

Pi's 0.85.1 package and extension documentation informed API/discovery integration. No Pi implementation or documentation files are vendored. The extension imports Pi's public host API and uses Node.js built-ins; autocomplete imports are type-only.

Direct development dependencies:

| Package | Declared license |
| --- | --- |
| `@earendil-works/pi-coding-agent` | MIT |
| `@earendil-works/pi-tui` | MIT |
| `@types/node` | MIT |
| `typescript` | Apache-2.0 |

Pi packages are peer dependencies supplied by the host and pinned as development dependencies for checking. Installed dependency trees remain governed by their own licenses, **not** this repository's MIT grant. `package-lock.json` records resolved versions and registry license metadata; `node_modules` is excluded. Transitive notices are not reproduced because dependency code is not vendored. Dependency metadata and a vulnerability scan do not constitute legal certification.
