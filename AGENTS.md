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
- `main.js` is gitignored and the maintainer copies it into the test vault by hand.
- **Only a paste into Obsidian settles whether something works.** You cannot test the
  plugin yourself.

### Rules for link metadata

1. **Site-specific code is the exception, not the rule.** Whether a site gets any code of
   its own, and what that code may do to each field, is decided by the field rules below —
   section A first.
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

### Field rules

Agreed with the maintainer on 2026-09-11, after an OpenStreetMap fetcher threw away data the
site had declared without a firm reason. They apply to every site the same way. An
exception exists only if it is written here, or recorded with its evidence in
`docs/domain-coverage.md`.

**Terms.**
- *Generic*: the same title, text or image comes back for two different links of the same
  kind, one of which cannot exist. Proven by a recorded two-paste test, never by impression.
- *Specific*: about this item and supplied by the site — a tag on the page, an endpoint
  field that is the item's own name, description or image, or a composition of the site's
  own data for this item (C3).
- *Attribute* vs *audience metric*: an attribute describes the thing (version, licence,
  duration, date, language, closed/archived); an audience metric counts people's reaction
  to it (likes, points, votes, comments, answers, stars, downloads, members, followers,
  views, "online now").
- *Furniture*: the description, image and favicon of a page we have decided not to believe.

**A. When a site gets code of its own** (a dedicated fetcher, or a hook in or after
`fetchGeneric` — both count)

- **A1.** Only with recorded evidence (the URLs used and what they returned) of at least one of:
  - (a) a live link answers with a page that is not about the link: a shell, a sign-in
    wall, a challenge, the site's homepage;
  - (b) a dead link's page does not prove it is dead (a 200, or a redirect to something that
    parses as a confident card), and an endpoint does;
  - (c) the plugin cannot read the page — confirmed in Obsidian, not by a script — and an
    endpoint answers;
  - (d) the generic read's description and image are both generic or absent, and a
    documented endpoint has data specific to the item.

  Not reasons: an ugly or verbose title, an API existing, extra data (version, licence,
  counts, duration), a bigger image, removing audience metrics.
- **A2.** The code covers only the URL shapes and cases where the failure was shown. The
  rest of the site stays generic.
- **A3.** Page first. An endpoint is asked only when the generic result is suspect (a
  shell, an empty page, an invariant title), when the A1 reason is the endpoint's data, or
  — in code A1 already justifies — to add a field the page does not give (Steam's
  developers as `author`). It adds; it does not replace what the page gives well.
- **A4.** A failure with a shape not tied to the site ("Client Challenge", `name=` og tags)
  is fixed in the parser or in `fetchGeneric`, not in a site's branch.
- **A5.** One declared exception to A1: a site template (B6), or a site-specific author
  property (`soundcloud:user`), may justify code with no failure — if it costs no extra
  request and its purpose is filling `author`. The no-extra-request condition applies only
  to code that exists *because of* this exception; a site A1 already justifies may spend a
  request on the author (A3). Removing audience metrics never justifies
  code on its own; if proposing it for a site anyway, say so to the maintainer explicitly.
- **A6.** A documented, versioned API is cheap to keep. Scraping and User-Agent sniffing are
  expensive and must be declared as fragile in the docs.

**B. Title**

- **B1.** The declared title is kept. The chain `og:title` → `twitter:title` → `<title>` →
  URL slug is parsing, not rewriting.
- **B2.** Universal cleanups, in the parser only, closed list: decoding entities and
  normalising whitespace; a separator left dangling at the end. Not on the list, on
  purpose: the site's own name as a suffix ("… | MDN" stays — measured 2026-09-11, it is
  rare, since most sites keep `og:title` clean and suffix only `<title>`, and stripping it
  can leave a title that means nothing: "Home - BBC News" → "Home"); "on \<Site\>" ("Why I
  write on Medium" is a real title); ids in brackets; Unicode format and directional
  characters (they keep mixed-direction names readable). A site's own suffix can still go
  through B6, on a site that has code.
- **B3.** A declared title is replaced only with proof that it names the site, not the
  link: (i) it is generic; (ii) `og:url` or a redirect points to a sign-in page or the
  homepage; (iii) an error status or a challenge page.
- **B4.** The replacement, in order: a name from an endpoint → the URL's own words
  (identifiers verbatim, prose through `deslug`) → a label from the URL's shape
  ("Discord channel").
- **B5.** Code that is justified does not rewrite a readable page's title — not with an
  endpoint's cleaner name, not translated (no `name:<lang>`). Only B2 and B6 apply.
- **B6.** A *site template* is a fixed shape a site builds its title or description with,
  shown on at least three links and recorded with the examples. On sites that have code,
  it allows exactly four operations: move the author segment into `author`; drop the
  site-name segment; drop an audience-metric segment; drop a technical id
  (OSM "Way: Tour Eiffel (5013364)" → "Way: Tour Eiffel" — the type prefix stays). Text
  that does not match the template exactly is left alone. When the URL carries a handle,
  the author segment must match it; otherwise the separator must occur exactly as often as
  the template says.

**C. Description**

- **C1.** Specific over generic: specific verbatim (page, then endpoint) → composed from the
  site's own data → generic declared → none.
- **C2.** Between two specific ones the page wins, unless it is a strict prefix of the
  endpoint's — i.e. truncated — in which case the full one is used.
- **C3.** A composition uses only this item's data from the same site, values joined by
  " · " and humanised at most as `deslug` does. No prose of our own, attributes only, and
  never appended to a declared specific description.
- **C4.** Audience metrics go wherever we control them: always from compositions, and from
  declared text via B6 on sites that have code. A site without code keeps what it declares.
  A card is a snapshot written into a note that lives for years, and it carries no date.
- **C5.** On a dead link, a shell or a sign-in wall, the page's description rides along as
  furniture — always, TikTok's "Log in or sign up…" included.

**D. Image**

- **D1.** Specific over generic: the page's → the endpoint's → generic declared → none.
- **D2.** A resolution variant of the same asset (same id, same CDN) is the same image. A
  different artwork is not: Steam's `header.jpg` does not replace the page's
  `capsule_616x353.jpg`.
- **D3.** Never the favicon or the apple-touch-icon as an image. An `og:image` that *is* the
  favicon is discarded, not replaced.
- **D4.** On a dead link or a shell the page's image rides along as furniture.

**E. Site name**

- **E1.** `og:site_name` is kept, cleaned universally: the first segment before a spaced
  separator, discarded if over 40 characters. When absent, `SITE_NAMES` is the floor, by
  host or by host and path.
- **E2.** `SITE_NAMES` overrides a declared name only when the host is a user subdomain of
  a platform it lists (`*.bandcamp.com`, `*.notion.site`). A structural test in the general
  mechanism, not a per-site hook.

**F. Author**

- **F1.** The generic parser should read an author universally (`meta name="author"`,
  `article:author` when it is not a URL, JSON-LD `author.name`). Not designed yet.
- **F2.** Sources allowed: a field declared as the author, an endpoint field, a site-specific
  property, a template segment (B6). Nothing guessed.
- **F3.** `linkTitle` is composed only from fields already held.

**G. Favicon**

- **G1.** The icon the page declares wins, else the `/favicon.ico` guess.
- **G2.** Hardcoded only when the code does not read the page and the guess was measured to
  fail (Discord, Bluesky).
- **G3.** Always rides along on dead-link and shell cards.

**H. Markdown-link label**

- **H1.** The label is the title (or `linkTitle`), then " - " and the site name from E.
- **H2.** Nothing is appended when the title already carries the name: as a whole word at
  either end, with or without a separator ("The Verge", "Obsidian - Sharpen your
  thinking", "Valve Complete Pack su Steam", "Steam app"), or as the last segment after a
  separator in the short form a site titles itself with ("… | MDN" for "MDN Web Docs").
  The site's own wording is then kept — what Auto Link Title writes in those cases too,
  since it uses the page's `<title>` untouched. Accepted price: a title ending in the word
  by coincidence ("How to use Spotify") gets no suffix. Presentation only — the stored
  title is untouched.
- **H3.** No known site name, no suffix — never the host.
- **H4.** The same link gets the same label whichever way it was made — pasted as a link or
  converted from a card. Not true yet: a card block stores neither `siteName` nor
  `linkTitle`, so conversion falls back to `SITE_NAMES` alone.

**I. Across all fields**

- **I1.** Microlink's answer counts as a read of the page; the same rules apply to it.
- **I2.** A refresh never clears a field.
- **I3.** Every exception is recorded with its evidence. Without it, it does not exist.

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
