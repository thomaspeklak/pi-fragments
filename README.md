# pi-fragments

Reusable Markdown snippets, inline in your [Pi](https://github.com/earendil-works/pi-mono) prompts. Compose several fragments without turning each one into a slash command.

```text
Explain the sample project. ::summary(audience:beginners) ::checklist(area:accessibility)
```

Fragments expand when you submit. This extension only transforms text: it does not select models, launch agents, execute template code, or require other extensions.

## Install

Requires Pi with `ctx.isProjectTrusted()` and `ctx.ui.addAutocompleteProvider()` (tested against **0.85.1**), and Node.js **22.19+**. Peer ranges follow Pi's package convention; they do not promise compatibility with every release.

```sh
pi install git:github.com/thomaspeklak/pi-fragments
```

Restart Pi or run `/reload`. To try without permanent installation:

```sh
pi -e git:github.com/thomaspeklak/pi-fragments
```

For project-local installation, add `-l` to `pi install`. Pin a Git tag or commit with `@<ref>`. Uninstall with `pi remove git:github.com/thomaspeklak/pi-fragments`. This is a Git-distributed package, not an npm publication.

## Your first fragment

Create `~/.pi/agent/fragments/summary.md`:

```markdown
---
description: Summarize a topic for a chosen audience
defaults:
  audience: beginners
---
Summarize the topic for {{args.audience}}. Separate facts from open questions.
```

Type `::sum` for autocomplete, then submit `::summary` or `::summary(audience:experts)` anywhere in a prompt. The former uses the default; the latter replaces it.

The [examples](examples/fragments) are invented, optional starting points. Copy the ones you want into your fragment directory; installing this package does **not** install examples into your library.

## Discovery and trust

- Global: `fragments/*.md` under Pi's agent directory (normally `~/.pi/agent`; respects Pi's configured agent directory).
- Project: `.pi/fragments/*.md` under the current working directory, **only while Pi considers the project trusted**. Rebranded Pi installations use their configured directory name.
- Discovery is non-recursive and includes regular `.md` files only, not symlink files. Names must match `[A-Za-z][A-Za-z0-9_-]*`.
- Lookup is case-insensitive. Project fragments override global fragments of the same name. Avoid filenames differing only in case within one directory; their winner is unspecified.
- A fragments-only directory may not trigger Pi's trust prompt. Use Pi's project-trust controls; this extension never grants trust itself.
- Names, descriptions, and bodies are cached lazily. Run `/fragments-reload` after adding, editing, or deleting files. This clears caches without reloading other extensions.

## Syntax reference

### Invocation and arguments

`::name`, `::name()`, and `::name(key:value,other:value)` work within prose, including quoted text. A known `:name` also expands, but autocomplete uses double colons. Unknown names remain ordinary text with either single or double colons (for example, `::regclass`), even when followed by parentheses. Only registered fragment names are expanded and have their arguments validated. Markers inside words and URLs are not invocations.

Arguments are comma-separated. Keys begin with an ASCII letter and contain letters, digits, `_`, or `-`; values begin with a letter or digit and contain those same characters. Keys normalize to lowercase; values preserve case. Whitespace around comma-separated items is allowed, but not around the colon. Duplicate keys (ignoring case), empty values, spaces/quotes in values, and malformed parentheses are rejected. Arbitrary keys are accepted, not just keys declared in defaults.

**Defaults are all-or-nothing:** no arguments (or empty parentheses) uses the entire defaults map. Supplying any arguments replaces that map, rather than merging it. `{{defaults.key}}` always accesses the original defaults. Use lowercase default keys to match normalized arguments.

### Frontmatter

Frontmatter must start at the beginning of the file between `---` lines. This is a small parser, **not YAML**:

- `description: short text` supplies autocomplete help (first 4 KiB inspected, description capped at 100 characters).
- `defaults:` followed by indented `key: value` lines defines string defaults; blank lines and full-line comments are allowed.
- Matching outer single or double quotes are removed. No escaping, multiline scalars, arrays, nested maps, or YAML type conversion.
- Other fields are ignored. There are no specialized argument formats or default-argument presets.

Leading/trailing whitespace is trimmed from bodies.

### Variables, sections, and composition

| Syntax | Meaning |
| --- | --- |
| `{{name}}` | Current fragment filename without `.md` |
| `{{args.key}}` | Explicit argument, or default when no arguments were supplied |
| `{{defaults.key}}` | Original default value |
| `{{#if args.key}}text{{/if}}` | Include text when the value is a nonempty string or nonempty map |
| `{{#each args}}{{key}}={{value}};{{/each}}` | Iterate map entries |
| `{{> checklist}}` | Include another fragment using its defaults |
| `{{> summary audience=args.audience}}` | Forward a string from the current context |

Variables are raw text, not escaped Markdown. Unknown variables remain literal. Sections use a lightweight regex renderer: **nesting sections of the same kind is not supported**; use separate includes for complex structure. No `else`, expressions, helpers, or full Mustache/Handlebars compatibility.

Include bindings use `key=context.path`, not literal values. Missing or empty binding values are omitted so a child can use its defaults; map values and duplicate keys are errors. Includes resolve through the same trusted global/project index. Each top-level invocation allows at most 100 fragment expansions and 16 levels. Cycles and missing includes block the entire submission. `::markers` inside bodies stay literal—only `{{> includes}}` compose fragments.

See [brief.md](examples/fragments/brief.md) for a complete composition example.

## Autocomplete and errors

Autocomplete offers up to 20 names (case-insensitive substring matching, prefix matches first), default keys, and default values. It preserves existing completion providers outside fragment syntax, handles cancellation, and replaces the rest of a token when completing mid-word.

Expansion is atomic: malformed arguments, unknown explicit fragments, include errors, and file read errors notify and block the whole prompt rather than send a partial expansion. Interactive errors restore the original text draft; RPC errors do not modify the editor. Attached images follow Pi's normal transform behavior. Expansion applies to any input event delivered by Pi, including RPC and extension-sourced inputs.

After success, the local Pi event bus receives `prompt-fragment:expanded` with `{ names: string[] }` (unique lowercase names, including includes). No prompt bodies are emitted by this extension.

**Limitations:** there is no Markdown-aware escaping or code-fence exemption: recognized markers can expand in quoted/code text too. Input transformations happen before Pi's built-in slash-template/skill expansion, so markers introduced by those later steps are not revisited. Fragment size and total output bytes are not capped; keep libraries and templates small.

## Development

```sh
git clone https://github.com/thomaspeklak/pi-fragments.git
cd pi-fragments
npm ci
npm test
npm run typecheck
pi -e ./extensions/fragments.ts
```

No build step or API key is required for tests. Tests use Node's native TypeScript support and temporary fragment directories, stubbing only Pi's host path import and extension callbacks. They cover composition, trust, errors, caching, completion, and limits; they do not automate the terminal UI or make model requests. The lockfile pins the development toolchain. No CI or publishing workflow is included.

## Safety and license

Review code before installing: Pi extensions run with your user's full permissions. Fragment text enters model context and may be stored in sessions or sent to your provider. Keep secrets out of fragments and review project overrides before trusting a repository. See [SECURITY.md](SECURITY.md).

Original project code is offered under [MIT](LICENSE). See [PROVENANCE.md](PROVENANCE.md) for development provenance and dependency licensing. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).
