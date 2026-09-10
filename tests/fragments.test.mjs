import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "pi-fragments-test-"));
await mkdir(join(root, "fragments"));
for (const name of ["summary", "checklist", "brief"]) {
  await writeFile(join(root, `fragments/${name}.md`), await readFile(new URL(`../examples/fragments/${name}.md`, import.meta.url)));
}
for (const [name, body] of Object.entries({
  forwarded: "---\ndefaults:\n  scope: new users,scope:all\n---\n{{> review scope=args.scope}}",
  mixedcase: "---\ndefaults:\n  scope: new users\n---\n{{> review SCOPE=args.scope}}",
  wrapper: "Start {{> checklist}} End ::checklist",
  nested: "{{> wrapper}}",
  repeated: "{{> checklist}}\n{{> checklist}}",
  missing: "{{> not-found}}",
  cycle: "{{> cycle-two}}",
  "cycle-two": "{{> cycle}}",
  self: "{{> self}}",
  badbinding: "{{> checklist area:2}}",
  duplicatebinding: "{{> checklist area=args.area AREA=args.area}}",
  objectbinding: "{{> checklist area=args}}",
  review: "---\ndefaults:\n  scope: all\n---\n{{#each args}}{{key}}={{value}};{{/each}}",
  condition: "{{#if args.scope}}Scope: {{args.scope}}{{/if}} {{defaults.scope}} {{unknown}}",
})) await writeFile(join(root, `fragments/${name}.md`), body);
// Stub only Pi's host paths; exercise the real extension's input handler and files.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export const CONFIG_DIR_NAME = '.pi'; export const getAgentDir = () => ${JSON.stringify(root)};`)}` };
    }
    return nextResolve(specifier, context);
  },
});
const { default: extension } = await import("../extensions/fragments.ts");
hooks.deregister();
after(() => rm(root, { recursive: true, force: true }));

async function expand(text, trusted = false) {
  const handlers = {};
  const notifications = [];
  const emitted = [];
  let draft;
  extension({ on: (name, handler) => { handlers[name] = handler; }, registerCommand() {}, events: { emit: (name, payload) => emitted.push({ name, payload }) } });
  const result = await handlers.input({ text, source: "interactive" }, {
    cwd: root, isProjectTrusted: () => trusted,
    ui: { notify: (message) => notifications.push(message), setEditorText: (text) => { draft = text; } },
  });
  if (result.action === "handled") assert.equal(draft, text);
  return { ...result, notifications, draft, emitted };
}

test("include forwarding preserves spaces and delimiters without argument injection", async () => {
  assert.equal((await expand("::forwarded")).text, "scope=new users,scope:all;");
  assert.equal((await expand("::mixedcase")).text, "scope=new users;");
});

test("generic fragments retain defaults, explicit arguments, and duplicate rejection", async () => {
  assert.equal((await expand("::review")).text, "scope=all;");
  assert.equal((await expand("::review(scope:auth,focus:errors)")).text, "scope=auth;focus=errors;");
  const invalid = await expand("::review(scope:a,scope:b)");
  assert.equal(invalid.action, "handled");
  assert.match(invalid.notifications[0], /Duplicate fragment argument/);
  assert.equal((await expand("::review(invalid)")).action, "handled");
});

for (const [fragment, error] of [["missing", /Missing included fragment/], ["cycle", /Circular fragment include/], ["self", /Circular fragment include/], ["badbinding", /Invalid include binding/], ["duplicatebinding", /Duplicate include binding/], ["objectbinding", /must be a string/]]) {
  test(`include error: ${fragment}`, async () => {
    const result = await expand(`::${fragment}`);
    assert.equal(result.action, "handled");
    assert.match(result.notifications[0], error);
  });
}

function completionHarness() {
  const handlers = {};
  let provider;
  extension({ on: (name, handler) => { handlers[name] = handler; }, registerCommand() {} });
  handlers.session_start({}, {
    cwd: root, isProjectTrusted: () => false,
    ui: { addAutocompleteProvider(factory) { provider = factory({
      triggerCharacters: ["#"],
      getSuggestions: () => ({ prefix: "fallback", items: [] }),
      applyCompletion: () => "fallback",
      shouldTriggerFileCompletion: () => true,
    }); } },
  });
  return provider;
}

test("ordinary input and unknown single-colon prose stay unchanged", async () => {
  for (const text of ["ordinary text", ":not-a-fragment", "C++ namespace::method", "https://example.test"]) {
    const result = await expand(text);
    assert.equal(result.action, "continue");
    assert.deepEqual(result.notifications, []);
    assert.equal(result.draft, undefined);
  }
});


test("composition, defaults, case-insensitive lookup, literal body markers", async () => {
  const checklist = (await expand("::checklist")).text;
  assert.equal((await expand(":CHECKLIST()")).text, checklist);
  assert.equal((await expand("::wrapper")).text, `Start ${checklist} End ::checklist`);
  assert.equal((await expand("::nested")).text, (await expand("::wrapper")).text);
  assert.equal((await expand("::repeated")).text, `${checklist}\n${checklist}`);
  assert.equal((await expand("::brief(audience:experts)")).text, `${(await expand("::summary(audience:experts)")).text}\n${checklist}`);
  assert.equal((await expand('"::checklist"')).text, `"${checklist}"`);
  assert.equal((await expand("::condition(scope:all)")).text, "Scope: all {{defaults.scope}} {{unknown}}");
});
for (const input of ["::review(scope:a,SCOPE:b)", "::review(scope:)", "::review(scope:a,)", "::review(scope:a", "::review(scope:(a))", "::review(scope:a)oops", "::review ::not-found"]) {
  test(`atomic error and draft restoration: ${input}`, async () => {
    const result = await expand(input);
    assert.equal(result.action, "handled");
    assert.equal(result.text, undefined);
    assert.equal(result.draft, input);
    assert.equal(result.notifications.length, 1);
    assert.deepEqual(result.emitted, []);
  });
}
test("project trust, changing trust, cache reload, RPC errors", async () => {
  await mkdir(join(root, ".pi/fragments"), { recursive: true });
  await writeFile(join(root, ".pi/fragments/checklist.md"), "Project checklist");
  const handlers = {}, commands = {};
  let trusted = true;
  extension({ on: (name, fn) => { handlers[name] = fn; }, registerCommand: (name, cmd) => { commands[name] = cmd; } });
  const ctx = { cwd: root, isProjectTrusted: () => trusted, ui: { notify() {}, setEditorText() { assert.fail("RPC draft modified"); } } };
  const event = { text: "::checklist", source: "rpc" };
  assert.equal((await handlers.input(event, ctx)).text, "Project checklist");
  trusted = false;
  assert.match((await handlers.input(event, ctx)).text, /usability/);
  await writeFile(join(root, "fragments/cached.md"), "One");
  await commands["fragments-reload"].handler("", ctx);
  assert.equal((await handlers.input({ ...event, text: "::cached" }, ctx)).text, "One");
  await writeFile(join(root, "fragments/cached.md"), "Two");
  assert.equal((await handlers.input({ ...event, text: "::cached" }, ctx)).text, "One");
  await commands["fragments-reload"].handler("", ctx);
  assert.equal((await handlers.input({ ...event, text: "::cached" }, ctx)).text, "Two");
  assert.equal((await handlers.input({ ...event, text: "::missing" }, ctx)).action, "handled");
});
test("autocomplete names, descriptions, keys, defaults, middle tokens, cancellation and fallback", async () => {
  const provider = completionHarness();
  const options = { signal: new AbortController().signal };
  for (const [input, value] of [["::sum", "::summary"], ["::summary(", "audience:"], ["::summary(audience:", "beginners"]]) {
    const result = await provider.getSuggestions([input], 0, input.length, options);
    assert.ok(result.items.some(item => item.value === value));
    assert.equal(provider.shouldTriggerFileCompletion([input], 0, input.length), false);
  }
  const line = "Text ::summary(audience:experts) tail";
  const cursor = "Text ::su".length;
  const result = await provider.getSuggestions([line], 0, cursor, options);
  assert.match(result.items[0].description, /chosen audience/);
  assert.equal(provider.applyCompletion([line], 0, cursor, result.items[0], result.prefix).lines[0], line);
  assert.equal(await provider.getSuggestions(["::summary("], 0, 10, { signal: AbortSignal.abort() }), null);
  assert.equal((await provider.getSuggestions(["hello"], 0, 5, options)).prefix, "fallback");
  assert.equal(provider.applyCompletion(["hello"], 0, 5, { value: "hello" }, "hello"), "fallback");
  assert.equal(provider.shouldTriggerFileCompletion(["hello"], 0, 5), true);
  const duplicate = "::summary(audience:experts,";
  assert.equal(await provider.getSuggestions([duplicate], 0, duplicate.length, options), null);
});
test("include budgets block runaway expansion", async () => {
  await writeFile(join(root, "fragments/wide.md"), "{{> checklist}}".repeat(100));
  assert.equal((await expand("::wide")).action, "handled");
  for (let i = 0; i < 17; i++) await writeFile(join(root, `fragments/depth${i}.md`), i === 16 ? "End" : `{{> depth${i + 1}}}`);
  assert.equal((await expand("::depth0")).action, "handled");
});
