# Contributing

Keep changes focused on generic fragment expansion. Open an issue for substantial syntax or behavior changes before implementing them.

Use Node.js 22.19+ and run `npm ci`, `npm test`, and `npm run typecheck`. Add regression tests for behavior changes, keep the README accurate, and include lockfile changes when updating dependencies. A manual `pi -e ./extensions/fragments.ts` check is useful for autocomplete changes.

Use only invented examples and temporary test directories. Never contribute personal fragments, session transcripts, secrets, environment-specific paths, or private service configuration. Do not add publishing automation or CI without discussion.

By contributing, you confirm you have permission to submit your work under this project's MIT license. Identify any third-party material and preserve its attribution and license; do not relicense it by omission.
