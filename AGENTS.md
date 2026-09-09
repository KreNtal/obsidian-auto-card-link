# Obsidian community plugin

## This repository in particular — read before anything else

Everything from "Project overview" down is Obsidian's sample-plugin boilerplate, kept
because it is a decent reference. **Where it conflicts with this section, this section
wins.** One conflict is live: the boilerplate says to split any file over 200-300 lines.
`src/link_metadata_fetcher.ts` is deliberately several thousand lines long, one method per
site, each with the evidence for its design in a comment above it. Do not refactor it into
modules unless asked.

**`docs/domain-coverage.md` is the source of truth for site handling.** It records every
site checked, what it returns, what was tried and rejected, and why. Read it before
touching anything to do with fetching metadata, and update it in the same commit as the
code. It also carries the release backlog. Nothing there should be re-derived from scratch.

### Working agreement

- **One site, or one problem, at a time.** Probe, implement, verify, hand over test links,
  wait for approval, commit. Then the next.
- **Ask before each commit, and separately before each push.** Approving an approach is not
  approving to ship it.
- **Never attribute yourself in a commit.** No `Co-Authored-By`, no "Generated with". The
  author is the maintainer.
- Commit messages are long and explanatory, in English: what was wrong, why this is the
  fix, and what was tried and rejected. The log is the project's record — match it.
- **Hand over test links after every fetcher change, unasked.** Bare URLs, one per line,
  **no bullet points and no backticks**, so a whole group can be copy-pasted at once. A
  comment on the same line is fine. Group them by case (live / dead / must not regress), and
  verify they are live at the moment of handing them over.
- `main.js` is gitignored and the maintainer copies it into the test vault by hand. Remind
  them to, every time.
- **Only a paste into Obsidian settles whether something works.** You cannot test the
  plugin yourself.

### Rules for link metadata

1. **A dedicated fetcher needs either a documented API or a provably wrong generic path.**
   Not "a fetcher per big domain". Every fetcher is perpetual maintenance: a documented,
   versioned API is cheap, scraping or User-Agent sniffing is expensive and must be
   declared as fragile in the docs.
2. **When an endpoint proves a link is dead, build the card from the URL — never hand it to
   `fetchGeneric`**, which cannot tell "gone" from "blocked" and would spend a Microlink
   request (quota ~25/day) rendering a page that says nothing. An API's *empty answer* is
   proof; an API's *failure to answer* (429, 5xx, dead network) proves nothing and stays on
   the normal path. Both look identical in a `!result` check — that is exactly how the bug
   got in the first time.
3. **A page we refuse to believe still keeps its furniture.** What is wrong with a shell is
   its *title*, which presents the site's homepage as if it were the link. Its description,
   image and favicon are the site's own furniture on a page we have established we cannot
   read, and they ride along. Do not spend an extra request to fetch furniture from a page
   already known to be empty.
4. **A 403 from a scripted probe is not evidence that the plugin is blocked.** `requestUrl`
   runs inside Electron and presents a real browser's TLS/HTTP2 fingerprint, which is what
   bot protection actually profiles. Scripted probes are a **lower bound**: if the probe
   gets through the plugin will; if it is refused, nothing follows. This has been got wrong
   six times. When re-checking, the test is **whether Microlink was called**, not whether a
   card appeared.
5. **Never modify the URL the user pasted.** No stripping parameters on a hunch.

**The failure to look for first is not "does this site block us".** It is a site that
*answers, with something else* — a marketing shell, a sign-in wall, its own homepage —
because parsing that *succeeds*, so nothing downstream, Microlink included, ever gets a
chance to notice. So test a new domain with two pastes: the live thing, and a URL that
cannot exist. If the dead one comes back with a title, read it carefully.

**A check on one domain that uncovers a general parser or dispatch bug takes precedence
over the domain.** That happened three times during 1.6, and each time it fixed more sites
than the one being looked at.

### Reuse before writing

In `src/link_metadata_fetcher.ts` unless noted: `buildUrlCard`, `errorPageCard`,
`withPageFurniture` (parsed card) and `withParsedFurniture` (raw HTML), `deslug(segment,
"sentence" | "title")`, `siteNameFor`, `SITE_NAMES`, `countLabel`, `compactCount`,
`request(url, headers, timeout)` (already passes `throw: false`, so statuses are visible),
`decodeHtmlContent`, `CRAWLER_UA`, and `fetchGeneric(url, { isUnusable, goneCard })` —
`isUnusable` means *we could not read the page* and leads to Microlink, `goneCard` means
*the page says it is not there*, which is proof, and leads to a URL-built card.
Domain matchers live in `src/checkif.ts`, response shapes in `src/interfaces.ts`, and
HTML parsing in `src/link_metadata_parser.ts`.

### Repository traps

- **Line endings.** Git blobs are LF; some working-tree files are CRLF. `git checkout --
  <path>` produces doubled CRs and corrupts them. To restore a file, write the blob's bytes
  directly (`git cat-file blob HEAD:<path>`). Check a file's endings before editing it with
  a script.
- Git sometimes reports a file as modified when it is byte-identical to HEAD (a stale index
  entry). Confirm with `git diff --stat` before concluding anything changed.
- `docs/domain-coverage.md` is full of wide tables. After editing one, count the unescaped
  pipes per row against its header — a broken row has been shipped before.
- Watch for invisible non-ASCII characters in regexes; a literal nbsp has already failed
  ESLint with "Irregular whitespace".
- Before handing anything over: `npx tsc --noEmit`, `npx eslint src/`, `npm run build`, all
  three clean.

### Release discipline

- **No version bump mid-release.** `manifest.json` stays put until the release is finished
  and the maintainer says so.
- Cutting a release: `npm version <x.y.z>` updates `manifest.json`, `package.json` and
  `versions.json`, commits, and creates the annotated tag. Pushing the tag triggers the
  workflow, which builds from source and creates a **draft** GitHub release with
  `main.js`, `manifest.json` and `styles.css`.
- Release notes follow the shape of the previous ones: `## Additions` and `## Fixes`,
  short user-facing bullets, no preamble and no tables. The reasoning belongs in the commit
  log and in `docs/domain-coverage.md`, not there.

---

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

## Environment & tooling

- Node.js: use current LTS (Node 18+ recommended).
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- To use eslint install eslint from terminal: `npm install -g eslint`
- To use eslint to analyze this project use this command: `eslint main.ts`
- eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder: `eslint ./src/`

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Example file structure**:
  ```
  src/
    main.ts           # Plugin entry point, lifecycle management
    settings.ts       # Settings interface and defaults
    commands/         # Command implementations
      command1.ts
      command2.ts
    ui/              # UI components, modals, views
      modal.ts
      view.ts
    utils/           # Utility functions, helpers
      helpers.ts
      constants.ts
    types.ts         # TypeScript interfaces and types
  ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):  
  - `id` (plugin ID; for local dev it should match the folder name)  
  - `name`  
  - `version` (Semantic Versioning `x.y.z`)  
  - `minAppVersion`  
  - `description`  
  - `isDesktopOnly` (boolean)  
  - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` (if any) to:
  ```
  <Vault>/.obsidian/plugins/<plugin-id>/
  ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` to map plugin version → minimum app version.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process to add/update your plugin in the community catalog as required.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):
```ts
import { Plugin } from "obsidian";
import { MySettings, DEFAULT_SETTINGS } from "./settings";
import { registerCommands } from "./commands";

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    registerCommands(this);
  }
}
```

**settings.ts**:
```ts
export interface MySettings {
  enabled: boolean;
  apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  apiKey: "",
};
```

**commands/index.ts**:
```ts
import { Plugin } from "obsidian";
import { doSomething } from "./my-command";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "do-something",
    name: "Do something",
    callback: () => doSomething(plugin),
  });
}
```

### Add a command

```ts
this.addCommand({
  id: "your-command-id",
  name: "Do the thing",
  callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`. 
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
