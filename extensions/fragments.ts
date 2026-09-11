import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { open, readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

type Fragment = {
	name: string;
	path: string;
	scope: "global" | "project";
};

type FragmentTemplate = {
	body: string;
	defaults: Record<string, string>;
};

type TemplateContext = Record<string, string | Record<string, string>>;

type ParsedArguments = { values: Record<string, string> } | { error: string };

const FRAGMENT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Scan starts separately so an unfinished argument list cannot bypass validation.
const FRAGMENT_START = /(^|[\s([{"'])(:{1,2})([A-Za-z][A-Za-z0-9_-]*)(?=$|[\s()\]}"',.!?;:])/gm;
const ARGUMENT_PREFIX = /(?:^|[\s([{"'])::([A-Za-z][A-Za-z0-9_-]*)\(([^()\r\n]*)$/;
const MAX_SUGGESTIONS = 20;
const DESCRIPTION_BYTES = 4_096;
const MAX_DESCRIPTION_LENGTH = 100;
const TEMPLATE_SECTION = /{{#(each|if)\s+([A-Za-z][A-Za-z0-9_.-]*)}}([\s\S]*?){{\/\1}}/g;
const TEMPLATE_VARIABLE = /{{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*}}/g;
const TEMPLATE_INCLUDE = /{{>\s*([A-Za-z][A-Za-z0-9_-]*)([^{}]*?)}}/g;

function fragmentDirectory(cwd: string, scope: Fragment["scope"]): string {
	return scope === "global"
		? join(getAgentDir(), "fragments")
		: join(cwd, CONFIG_DIR_NAME, "fragments");
}

async function scanDirectory(directory: string, scope: Fragment["scope"]): Promise<Fragment[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => ({ name: parse(entry.name).name, path: join(directory, entry.name), scope }))
			.filter((fragment) => FRAGMENT_NAME.test(fragment.name));
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function extractFragmentPrefix(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[\s([{"'])::([A-Za-z0-9_-]*)$/);
	return match?.[1];
}

function filterFragments(fragments: Iterable<Fragment>, query: string): Fragment[] {
	const normalizedQuery = query.toLowerCase();
	return [...fragments]
		.filter((fragment) => fragment.name.toLowerCase().includes(normalizedQuery))
		.sort((left, right) => {
			const leftStarts = left.name.toLowerCase().startsWith(normalizedQuery);
			const rightStarts = right.name.toLowerCase().startsWith(normalizedQuery);
			if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
			return left.name.localeCompare(right.name);
		})
		.slice(0, MAX_SUGGESTIONS);
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	return match
		? { frontmatter: match[1], body: content.slice(match[0].length).trim() }
		: { frontmatter: "", body: content.trim() };
}

function unquote(value: string): string {
	return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}

function descriptionFromFrontmatter(frontmatter: string): string | undefined {
	const value = frontmatter.match(/^description:\s*(.+?)\s*$/m)?.[1];
	if (!value) return undefined;

	const description = unquote(value);
	return description.length > MAX_DESCRIPTION_LENGTH
		? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
		: description;
}

function defaultsFromFrontmatter(frontmatter: string): Record<string, string> {
	const defaults: Record<string, string> = {};
	const lines = frontmatter.split(/\r?\n/);
	const defaultsIndex = lines.findIndex((line) => /^defaults:\s*(?:#.*)?$/.test(line));
	if (defaultsIndex === -1) return defaults;

	for (const line of lines.slice(defaultsIndex + 1)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const match = line.match(/^\s{2,}([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/);
		if (!match) break;
		defaults[match[1]] = unquote(match[2]);
	}
	return defaults;
}

async function readDescription(path: string): Promise<string | undefined> {
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(DESCRIPTION_BYTES);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		return descriptionFromFrontmatter(splitFrontmatter(buffer.toString("utf8", 0, bytesRead)).frontmatter);
	} finally {
		await file.close();
	}
}

function parseArguments(raw: string | undefined): ParsedArguments {
	if (!raw?.trim()) return { values: {} };

	const values: Record<string, string> = {};
	for (const item of raw.split(",")) {
		const match = item.trim().match(/^([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9][A-Za-z0-9_-]*)$/);
		if (!match) return { error: `Invalid fragment argument: ${item.trim()}` };

		const [, key, value] = match;
		if (Object.hasOwn(values, key.toLowerCase())) return { error: `Duplicate fragment argument: ${key}` };
		values[key.toLowerCase()] = value;
	}
	return { values };
}

function argumentSuggestions(raw: string, template: FragmentTemplate, afterCursor: string): { prefix: string; items: AutocompleteItem[] } {
	const entries = raw.split(",");
	const current = entries.pop()!.trimStart();
	const right = afterCursor.split(/[()\r\n]/, 1)[0];
	const [, ...laterEntries] = right.split(",");
	const usedKeys = [...entries, ...laterEntries].map((entry) => entry.trim().split(":")[0].trim().toLowerCase());
	let prefix = current;
	let items: AutocompleteItem[] = [];
	const offer = (value: string, description: string, label = value) => items.push({ value, label, description });
	{
		const keys = Object.keys(template.defaults);
		const colon = current.indexOf(":");
		if (colon < 0) {
			for (const key of keys) if (!usedKeys.includes(key)) offer(`${key}:`, `Set ${key}`);
		} else {
			const key = current.slice(0, colon).trim().toLowerCase();
			prefix = current.slice(colon + 1).trimStart();
			if (!usedKeys.includes(key)) {
				if (Object.hasOwn(template.defaults, key)) offer(template.defaults[key], `Default ${key}`);
			}
		}
	}
	const query = prefix.toLowerCase();
	items = items.filter((item) => item.value.startsWith(query) || item.label.toLowerCase().includes(query));
	return { prefix, items: items.slice(0, MAX_SUGGESTIONS) };
}

function lookup(context: TemplateContext, path: string): string | Record<string, string> | undefined {
	let value: string | Record<string, string> | TemplateContext | undefined = context;
	for (const key of path.split(".")) {
		if (!value || typeof value === "string" || !Object.hasOwn(value, key)) return undefined;
		value = value[key];
	}
	return value as string | Record<string, string> | undefined;
}

function isTruthy(value: string | Record<string, string> | undefined): boolean {
	return typeof value === "string" ? value.length > 0 : Boolean(value && Object.keys(value).length > 0);
}

function renderTemplate(template: string, context: TemplateContext): string {
	const sections = template.replace(TEMPLATE_SECTION, (_match, kind: "each" | "if", path: string, body: string) => {
		const value = lookup(context, path);
		if (kind === "if") return isTruthy(value) ? renderTemplate(body, context) : "";
		if (!value || typeof value === "string") return "";

		return Object.entries(value)
			.map(([key, item]) => renderTemplate(body, { ...context, key, value: item }))
			.join("");
	});

	return sections.replace(TEMPLATE_VARIABLE, (token, path: string) => {
		const value = lookup(context, path);
		return typeof value === "string" ? value : token;
	});
}

function fragmentContext(fragment: Fragment, template: FragmentTemplate, raw: string | Record<string, string> | undefined): TemplateContext {
	const parsed = typeof raw === "object" ? { values: raw } : parseArguments(raw);
	if ("error" in parsed) throw new Error(parsed.error);
	const args = Object.keys(parsed.values).length ? parsed.values : template.defaults;
	return { name: fragment.name, args, defaults: template.defaults };
}

export default function (pi: ExtensionAPI): void {
	let fragmentIndex: Promise<Map<string, Fragment>> | undefined;
	let fragmentIndexKey: string | undefined;
	const templates = new Map<string, Promise<FragmentTemplate>>();
	const descriptions = new Map<string, Promise<string | undefined>>();

	const clearCache = (): void => {
		fragmentIndex = undefined;
		templates.clear();
		descriptions.clear();
	};

	const getFragments = async (cwd: string, includeProject: boolean): Promise<Map<string, Fragment>> => {
		const key = JSON.stringify([cwd, includeProject]);
		if (!fragmentIndex || fragmentIndexKey !== key) {
			fragmentIndexKey = key;
			fragmentIndex = (async () => {
				const globalFragments = await scanDirectory(fragmentDirectory(cwd, "global"), "global");
				const projectFragments = includeProject
					? await scanDirectory(fragmentDirectory(cwd, "project"), "project")
					: [];
				const byName = new Map<string, Fragment>();

				for (const fragment of globalFragments) byName.set(fragment.name.toLowerCase(), fragment);
				for (const fragment of projectFragments) byName.set(fragment.name.toLowerCase(), fragment);
				return byName;
			})();
		}
		return fragmentIndex;
	};

	const readTemplate = (fragment: Fragment): Promise<FragmentTemplate> => {
		let template = templates.get(fragment.path);
		if (!template) {
			template = readFile(fragment.path, "utf8").then((content) => {
				const { frontmatter, body } = splitFrontmatter(content);
				return {
					body,
					defaults: defaultsFromFrontmatter(frontmatter),
				};
			});
			templates.set(fragment.path, template);
		}
		return template;
	};

	// Only explicit includes are expanded; :: markers inside fragment bodies remain literal.
	const expandFragment = async (
		fragment: Fragment,
		raw: string | Record<string, string> | undefined,
		fragments: Map<string, Fragment>,
		stack: string[] = [],
		budget = { remaining: 100 },
		expanded = new Set<string>(),
	): Promise<string> => {
		const name = fragment.name.toLowerCase();
		expanded.add(name);
		if (stack.includes(name)) throw new Error(`Circular fragment include: ${[...stack, name].join(" -> ")}`);
		if (stack.length >= 16 || --budget.remaining < 0) throw new Error("Fragment include limit exceeded");
		const template = await readTemplate(fragment);
		const context = fragmentContext(fragment, template, raw);
		const rendered = renderTemplate(template.body, context);
		const parts: string[] = [];
		let end = 0;
		for (const match of rendered.matchAll(TEMPLATE_INCLUDE)) {
			const [token, childName, includeBindings] = match;
			const child = fragments.get(childName.toLowerCase());
			if (!child) throw new Error(`Missing included fragment: ${childName} (in ${name})`);
			const args: Record<string, string> = Object.create(null);
			const keys = new Set<string>();
			for (const binding of includeBindings.trim() ? includeBindings.trim().split(/\s+/) : []) {
				const parsed = binding.match(/^([A-Za-z][A-Za-z0-9_-]*)=([A-Za-z][A-Za-z0-9_.-]*)$/);
				if (!parsed) throw new Error(`Invalid include binding: ${binding}. Use key=context.path.`);
				const [, key, path] = parsed;
				if (keys.has(key.toLowerCase())) throw new Error(`Duplicate include binding: ${key}`);
				keys.add(key.toLowerCase());
				const value = lookup(context, path);
				// Absent optional bindings let the included fragment use its own defaults.
				if (value === undefined || value === "") continue;
				if (typeof value !== "string") throw new Error(`Include binding must be a string: ${path}`);
				args[key.toLowerCase()] = value;
			}
			parts.push(rendered.slice(end, match.index), await expandFragment(child, args, fragments, [...stack, name], budget, expanded));
			end = match.index! + token.length;
		}
		parts.push(rendered.slice(end));
		return parts.join("");
	};

	const getDescription = (fragment: Fragment): Promise<string | undefined> => {
		let description = descriptions.get(fragment.path);
		if (!description) {
			description = readDescription(fragment.path);
			descriptions.set(fragment.path, description);
		}
		return description;
	};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => ({
			triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), ":", "(", ","])],
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
				const argumentMatch = before.match(ARGUMENT_PREFIX);
				if (argumentMatch) {
					try {
						const fragments = await getFragments(ctx.cwd, ctx.isProjectTrusted());
						const fragment = fragments.get(argumentMatch[1].toLowerCase());
						if (!fragment || options.signal.aborted) return null;
						const result = argumentSuggestions(argumentMatch[2], await readTemplate(fragment), (lines[cursorLine] ?? "").slice(cursorCol));
						return options.signal.aborted || !result.items.length ? null : result;
					} catch { return null; }
				}
				const prefix = extractFragmentPrefix(before);
				if (prefix === undefined) return current.getSuggestions(lines, cursorLine, cursorCol, options);

				const fragments = await getFragments(ctx.cwd, ctx.isProjectTrusted());
				if (options.signal.aborted) return null;

				const matches = filterFragments(fragments.values(), prefix);
				if (matches.length === 0) return null;

				const items: AutocompleteItem[] = await Promise.all(matches.map(async (fragment) => ({
					value: `::${fragment.name}`,
					label: `::${fragment.name}`,
					description: (await getDescription(fragment)) ?? `${fragment.scope} fragment`,
				})));
				return options.signal.aborted ? null : { prefix: `::${prefix}`, items };
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				const line = lines[cursorLine] ?? "";
				const before = line.slice(0, cursorCol);
				if (ARGUMENT_PREFIX.test(before) || extractFragmentPrefix(before) !== undefined) {
					// Replace the rest of the token too when completing in the middle of a word.
					let tail = line.slice(cursorCol).replace(/^[A-Za-z0-9_-]*/, "");
					if (item.value.endsWith(":") && tail.startsWith(":")) tail = tail.slice(1);
					const updated = [...lines];
					updated[cursorLine] = line.slice(0, cursorCol - prefix.length) + item.value + tail;
					return { lines: updated, cursorLine, cursorCol: cursorCol - prefix.length + item.value.length };
				}
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
				if (ARGUMENT_PREFIX.test(before) || extractFragmentPrefix(before) !== undefined) return false;
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});

	pi.on("input", async (event, ctx) => {
		const starts = [...event.text.matchAll(FRAGMENT_START)];
		if (!starts.length) return { action: "continue" };
		try {
			const fragments = await getFragments(ctx.cwd, ctx.isProjectTrusted());
			const parts: string[] = [];
			const expanded = new Set<string>();
			let lastIndex = 0;
			for (const match of starts) {
				const [token, boundary, marker, rawName] = match;
				if (match.index! < lastIndex) continue;
				const fragment = fragments.get(rawName.toLowerCase());
				// Only registered names are fragments; unknown markers remain ordinary text.
				if (!fragment) continue;
				let end = match.index! + token.length;
				let raw: string | undefined;
				if (event.text[end] === "(") {
					const argumentsMatch = event.text.slice(end).match(/^\(([^()\r\n]*)\)/);
					if (!argumentsMatch) throw new Error(`Incomplete or malformed ${marker}${rawName} arguments. Close the parentheses before submitting.`);
					raw = argumentsMatch[1];
					end += argumentsMatch[0].length;
					if (end < event.text.length && !/[\s)\]}"',.!?;:]/.test(event.text[end])) throw new Error(`Unexpected text after ${marker}${rawName} arguments.`);
				}
				parts.push(event.text.slice(lastIndex, match.index), boundary, await expandFragment(fragment, raw, fragments, [], { remaining: 100 }, expanded));
				lastIndex = end;
			}
			if (!parts.length) return { action: "continue" };
			parts.push(event.text.slice(lastIndex));
			pi.events?.emit?.("prompt-fragment:expanded", {
				names: [...expanded],
			});
			return { action: "transform", text: parts.join("") };
		} catch (error) {
			ctx.ui.notify(`Fragment submission blocked: ${error instanceof Error ? error.message : String(error)}`, "error");
			if (event.source === "interactive") ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}
	});

	pi.registerCommand("fragments-reload", {
		description: "Clear the lazy fragment cache",
		handler: async (_args, ctx) => {
			clearCache();
			ctx.ui.notify("Fragment cache cleared", "info");
		},
	});
}
