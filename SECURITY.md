# Security

Pi extensions execute with full user permissions. This extension reads Markdown from Pi's global fragment directory and, only when trusted, the current project's fragment directory. It does not execute template code or make network requests. Fragment instructions still reach your model and may cause tool use; project trust is not a sandbox.

Treat fragment bodies, arguments, and descriptions as potentially sensitive. Expanded text may enter provider requests and Pi session files; autocomplete displays descriptions. No redaction is performed. Error messages may contain filenames or arguments. Keep secrets out of fragments and review overrides and includes before trusting a project. Expansion depth/count limits are not a general resource sandbox; file/output byte sizes are unbounded.

For sensitive reports, use GitHub's private vulnerability reporting on this repository if available. If unavailable, ask the maintainer in an issue for a private channel without disclosing exploit details, secrets, or private fragments. For non-sensitive bugs, include a minimal invented reproduction and your Node/Pi versions. No response-time or supported-release guarantee is offered.
