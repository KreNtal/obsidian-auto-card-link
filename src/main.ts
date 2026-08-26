import { Plugin, MarkdownView, Editor, EditorRange, Menu, MenuItem, Notice } from "obsidian";

import {
  ObsidianAutoCardLinkSettings,
  ObsidianAutoCardLinkSettingTab,
  DEFAULT_SETTINGS,
  applyThumbnailPosition,
  applyCardStyle,
  applyThumbnailFit
} from "./settings";

import { EditorExtensions } from "./editor_enhancements";
import { CheckIf } from "./checkif";
import { CodeBlockGenerator } from "./code_block_generator";
import { LinkMetadataFetcher } from "./link_metadata_fetcher";
import { CodeBlockProcessor } from "./code_block_processor";
import { linkLineRegex, lineRegex } from "./regex";

type PasteShape = "card" | "markdown-link";

/** Settings that existed before the shape dropdowns absorbed their off state. */
interface LegacyEnhanceSettings {
  enhanceDefaultPaste?: boolean;
  enhanceDefaultDrop?: boolean;
}

export default class ObsidianAutoCardLink extends Plugin {
  settings?: ObsidianAutoCardLinkSettings;
  private cachedClipboard = "";
  private savedScrollTop = 0;
  private scrollAnchor?: { el: HTMLElement; url?: string; offsetTop: number; };
  private refreshQueue = Promise.resolve();
  private refreshQueueDepth = 0;

  async onload() {
    await this.loadSettings();

    void this.updateClipboardCache();
    this.registerDomEvent(window, "focus", this.updateClipboardCache);
    this.registerDomEvent(activeDocument, "contextmenu", this.updateClipboardCache);
    // Capture the scroll state before Obsidian's mousedown handler moves the cursor
    this.registerDomEvent(activeDocument, "mousedown", (e: MouseEvent) => {
      if (e.button !== 2) return;
      const scroller = this.getEditorScroller();
      if (!scroller) return;

      this.savedScrollTop = scroller.scrollTop;

      const target = e.target as Node | null;
      const card = target?.instanceOf(HTMLElement)
        ? target.closest<HTMLElement>(".auto-card-link-container")
        : null;

      this.scrollAnchor = card
        ? {
          el: card,
          url: card.dataset.cardlinkUrl,
          offsetTop: card.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        }
        : undefined;
    }, { capture: true });

    this.registerMarkdownCodeBlockProcessor("cardlink", async (source, el, ctx) => {
      const processor = new CodeBlockProcessor(this.app);
      await processor.run(source, el);

      const info = ctx.getSectionInfo(el);
      const urlMatch = source.match(/^url:\s*(.+)$/m);
      const url = urlMatch?.[1]?.trim().replace(/^["']|["']$/g, "");

      if (info && url) {
        const container = el.querySelector<HTMLElement>(".auto-card-link-container");
        if (container) {
          container.dataset.cardlinkUrl = url;
          container.dataset.cardlinkLineStart = String(info.lineStart);
          container.dataset.cardlinkLineEnd = String(info.lineEnd);
        }
      }
    });

    applyThumbnailPosition(this.settings?.thumbnailPosition ?? "left");
    applyCardStyle(this.settings?.cardStyle ?? "classic");
    applyThumbnailFit(this.settings?.thumbnailFit ?? "cover");

    this.addCommand({
      id: "auto-card-link-paste-and-enhance",
      name: "Paste URL and enhance to card link",
      editorCallback: async (editor: Editor) => {
        await this.manualPasteAndEnhanceURL(editor);
      },
    });

    this.addCommand({
      id: "auto-card-link-enhance-selected-url",
      name: "Enhance selected URL to card link",
      editorCheckCallback: (checking: boolean, editor: Editor) => {
        if (!navigator.onLine) return false;
        if (checking) return true;
        void this.enhanceSelectedURL(editor);
        return true;
      }
    });

    this.addCommand({
      id: "auto-card-link-paste-and-enhance-markdown-link",
      name: "Paste URL and enhance to Markdown link",
      editorCallback: async (editor: Editor) => {
        await this.manualPasteAndEnhanceURL(editor, "markdown-link");
      },
    });

    this.addCommand({
      id: "auto-card-link-enhance-selected-url-markdown-link",
      name: "Enhance selected URL to Markdown link",
      editorCheckCallback: (checking: boolean, editor: Editor) => {
        if (!navigator.onLine) return false;
        if (checking) return true;
        void this.enhanceSelectedURL(editor, "markdown-link");
        return true;
      }
    });

    this.registerEvent(this.app.workspace.on("editor-paste", this.onPaste));
    this.registerEvent(this.app.workspace.on("editor-drop", this.onDrop));
    this.registerEvent(this.app.workspace.on("editor-menu", this.onEditorMenu));
    this.addSettingTab(new ObsidianAutoCardLinkSettingTab(this.app, this));
  }

  private getEditorScroller(): HTMLElement | undefined {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.containerEl.querySelector<HTMLElement>(".cm-scroller") ?? undefined;
  }

  /**
   * Keeps the right-clicked card visually still while the menu opens.
   *
   * Restoring a saved scrollTop only holds if the layout above the card is unchanged, and
   * that is precisely what changes here: the cursor lands in the fenced block, Live Preview
   * swaps the rendered card for its source, and cards elsewhere finish measuring as their
   * images arrive. Re-anchoring on the element instead pins it to the same viewport offset
   * however much the document above it grew or shrank.
   *
   * The correction repeats for a few frames because those re-measures land asynchronously
   * rather than all in the first one - a single requestAnimationFrame is what made the
   * previous attempt reduce the jump without removing it.
   */
  private stabilizeScroll(): void {
    const scroller = this.getEditorScroller();
    const anchor = this.scrollAnchor;
    if (!scroller || !anchor) return;

    const savedTop = this.savedScrollTop;
    const deadline = window.performance.now() + 300;

    const step = () => {
      // A re-render replaces the card's element, so re-acquire it by URL before falling
      // back to the pixel offset, which is all that is left once the element is gone.
      if (!anchor.el.isConnected && anchor.url) {
        const replacement = activeDocument.querySelector<HTMLElement>(
          `.auto-card-link-container[data-cardlink-url="${CSS.escape(anchor.url)}"]`
        );
        if (replacement) anchor.el = replacement;
      }

      if (anchor.el.isConnected) {
        const offsetTop = anchor.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const drift = offsetTop - anchor.offsetTop;
        if (Math.abs(drift) > 0.5) scroller.scrollTop += drift;
      } else {
        scroller.scrollTop = savedTop;
      }

      if (window.performance.now() < deadline) window.requestAnimationFrame(step);
    };

    window.requestAnimationFrame(step);
  }

  /**
   * Runs a context-menu action while holding the viewport still.
   *
   * Obsidian's own scroll position is line-based (MarkdownSubView.getScroll), which is what
   * makes it the right anchor for an edit: rewriting the block under the pointer — seven
   * fenced lines collapsing into a one-line link, or the reverse — moves every pixel offset
   * below it, but never the number of the line sitting at the top of the viewport.
   *
   * (stabilizeScroll anchors on the element instead, because there nothing is rewritten:
   * the card stays put and only its measured height changes.)
   */
  private async withPreservedScroll(action: () => void | Promise<void>): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      await action();
      return;
    }

    const scroll = view.currentMode.getScroll();
    const running = action();
    // Assert once for the synchronous part — for a fetching action that is the placeholder
    // taking the block's place, which is the first and largest jump.
    this.holdScroll(view, scroll);

    await running;

    // Re-assert for the final replacement, unless the reader scrolled away meanwhile: a
    // fetch can take seconds, and yanking them back to where they no longer are is worse
    // than the drift this is fixing.
    if (Math.abs(view.currentMode.getScroll() - scroll) < 2) this.holdScroll(view, scroll);
  }

  /**
   * Re-asserts a line-based scroll position for a few frames: a card renders, measures and
   * loads its image across several of them, so a single correction lands too early.
   */
  private holdScroll(view: MarkdownView, scroll: number): void {
    const deadline = window.performance.now() + 300;

    const step = () => {
      if (Math.abs(view.currentMode.getScroll() - scroll) > 0.05) {
        view.currentMode.applyScroll(scroll);
      }
      if (window.performance.now() < deadline) window.requestAnimationFrame(step);
    };

    step();
  }

  private getCardlinkAtMouse(): { url: string; lineStart: number; lineEnd: number; } | undefined {
    // Use :hover on the element itself, not as a descendant selector
    const el = activeDocument.querySelector(".auto-card-link-container[data-cardlink-url]:hover");
    if (!el || !(el.instanceOf(HTMLElement))) return;

    const url = el.dataset.cardlinkUrl;
    const lineStart = parseInt(el.dataset.cardlinkLineStart ?? "");
    const lineEnd = parseInt(el.dataset.cardlinkLineEnd ?? "");

    if (!url || isNaN(lineStart) || isNaN(lineEnd)) return;
    return { url, lineStart, lineEnd };
  }

  private getCardlinkUrlAtCursor(editor: Editor): string | undefined {
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const lines = content.split(/\r?\n/);

    const searchRadius = 20;
    const searchStart = Math.max(0, cursor.line - searchRadius);
    const searchEnd = Math.min(lines.length - 1, cursor.line + searchRadius);

    let bestUrl: string | undefined;
    let bestDistance = Infinity;

    let i = searchStart;
    while (i <= searchEnd) {
      const line = lines[i] ?? "";
      if (line.trim().startsWith("```cardlink")) {
        const blockStart = i;
        let blockEnd = -1;
        let url: string | undefined;

        for (let j = blockStart + 1; j < lines.length; j++) {
          const inner = lines[j] ?? "";
          if (!url) {
            const m = inner.match(/^url:\s*(.+)$/);
            if (m) url = m[1]?.trim().replace(/^["']|["']$/g, "");
          }
          if (inner.trim() === "```") {
            blockEnd = j;
            break;
          }
        }

        if (blockEnd >= 0 && url) {
          const distance = cursor.line >= blockStart && cursor.line <= blockEnd
            ? 0
            : Math.min(
              Math.abs(cursor.line - blockStart),
              Math.abs(cursor.line - blockEnd)
            );

          if (distance < bestDistance) {
            bestDistance = distance;
            bestUrl = url;
          }
          i = blockEnd + 1;
          continue;
        }
      }
      i++;
    }

    return bestDistance === 0 ? bestUrl : undefined;
  }

  /**
   * Finds a rendered `[text](url)` markdown link on the cursor's current line, if the
   * cursor sits inside it. Obsidian moves the cursor to the click position before firing
   * editor-menu (getCardlinkUrlAtCursor above relies on the same behaviour), so this also
   * covers a right-click on a link rendered in Live Preview.
   */
  private getMarkdownLinkAtCursor(editor: Editor): EditorRange | undefined {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    for (const match of line.matchAll(new RegExp(linkLineRegex))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (match[2] && cursor.ch >= start && cursor.ch <= end) {
        return { from: { line: cursor.line, ch: start }, to: { line: cursor.line, ch: end } };
      }
    }
    return undefined;
  }

  /** A bare URL under the cursor, ignoring the one inside a markdown link's parentheses. */
  private getBareUrlAtCursor(editor: Editor): EditorRange | undefined {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    const linkRanges: Array<[number, number]> = [];
    for (const match of line.matchAll(new RegExp(linkLineRegex))) {
      const start = match.index ?? 0;
      linkRanges.push([start, start + match[0].length]);
    }

    for (const match of line.matchAll(new RegExp(lineRegex))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (linkRanges.some(([from, to]) => start >= from && start < to)) continue;
      if (cursor.ch >= start && cursor.ch <= end) {
        return { from: { line: cursor.line, ch: start }, to: { line: cursor.line, ch: end } };
      }
    }
    return undefined;
  }

  private resolveCardlinkRange(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): { url: string; blockEnd: number; startPos: { line: number; ch: number; }; endPos: { line: number; ch: number; }; } | undefined {
    const url = typeof cardlink === "string" ? cardlink : cardlink.url;
    const lines = editor.getValue().split(/\r?\n/);

    let blockStart = -1;
    let blockEnd = -1;

    const findBlockByUrl = (searchUrl: string, startLine = 0): { start: number; end: number; } | undefined => {
      let i = startLine;
      while (i < lines.length) {
        const line = lines[i] ?? "";
        if (line.trim().startsWith("```cardlink")) {
          let end = -1;
          let foundUrl: string | undefined;
          for (let j = i + 1; j < lines.length; j++) {
            const inner = lines[j] ?? "";
            if (!foundUrl) {
              const m = inner.match(/^url:\s*(.+)$/);
              if (m) foundUrl = m[1]?.trim().replace(/^["']|["']$/g, "");
            }
            if (inner.trim() === "```") { end = j; break; }
          }
          if (end >= 0 && foundUrl === searchUrl) return { start: i, end };
          i = end >= 0 ? end + 1 : i + 1;
          continue;
        }
        i++;
      }
      return undefined;
    };

    if (typeof cardlink === "object") {
      // Verify the stored coordinates are still correct (they can go stale after edits)
      const startLine = lines[cardlink.lineStart] ?? "";
      const endLine = lines[cardlink.lineEnd] ?? "";
      if (startLine.trim().startsWith("```cardlink") && endLine.trim() === "```") {
        let storedUrl: string | undefined;
        for (let j = cardlink.lineStart + 1; j < cardlink.lineEnd; j++) {
          const m = (lines[j] ?? "").match(/^url:\s*(.+)$/);
          if (m) { storedUrl = m[1]?.trim().replace(/^["']|["']$/g, ""); break; }
        }
        if (storedUrl === url) {
          blockStart = cardlink.lineStart;
          blockEnd = cardlink.lineEnd;
        }
      }
      // Coordinates were stale — scan the whole document for the correct block
      if (blockStart < 0) {
        const found = findBlockByUrl(url);
        if (found) { blockStart = found.start; blockEnd = found.end; }
      }
    } else {
      const cursor = editor.getCursor();
      let bestDistance = Infinity;
      let i = Math.max(0, cursor.line - 20);

      while (i < lines.length) {
        const line = lines[i] ?? "";
        if (line.trim().startsWith("```cardlink")) {
          let end = -1;
          let foundUrl: string | undefined;
          for (let j = i + 1; j < lines.length; j++) {
            const inner = lines[j] ?? "";
            if (!foundUrl) {
              const m = inner.match(/^url:\s*(.+)$/);
              if (m) foundUrl = m[1]?.trim().replace(/^["']|["']$/g, "");
            }
            if (inner.trim() === "```") { end = j; break; }
          }
          if (end >= 0 && foundUrl === url) {
            const dist = cursor.line >= i && cursor.line <= end
              ? 0
              : Math.min(Math.abs(cursor.line - i), Math.abs(cursor.line - end));
            if (dist < bestDistance) {
              bestDistance = dist;
              blockStart = i;
              blockEnd = end;
            }
          }
          i = end >= 0 ? end + 1 : i + 1;
          continue;
        }
        i++;
      }
    }

    if (blockStart < 0 || blockEnd < 0) return undefined;

    const startPos = { line: blockStart, ch: 0 };

    let consumeUntil = blockEnd;
    while (
      consumeUntil + 1 < lines.length &&
      (lines[consumeUntil + 1] ?? "").trim() === ""
    ) {
      consumeUntil++;
    }

    const endPos = consumeUntil + 1 < lines.length
      ? { line: consumeUntil + 1, ch: 0 }
      : { line: consumeUntil, ch: (lines[consumeUntil] ?? "").length };

    return { url, blockEnd, startPos, endPos };
  }

  private refetchCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): Promise<void> {
    this.refreshQueueDepth++;
    if (this.refreshQueueDepth > 1) {
      new Notice(`Refresh queued — ${this.refreshQueueDepth - 1} already in progress`);
    }
    this.refreshQueue = this.refreshQueue
      .then(() => this.doRefetchCardlink(editor, cardlink))
      .catch(() => { })
      .finally(() => { this.refreshQueueDepth--; });
    return this.refreshQueue;
  }

  private async doRefetchCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): Promise<void> {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;
    const { url, startPos, endPos } = range;

    // Save the original block so we can restore it exactly if the fetch fails
    const originalBlock = editor.getRange(startPos, endPos);

    editor.replaceRange(url, startPos, endPos);
    editor.setCursor(startPos);
    editor.setSelection(startPos, { line: startPos.line, ch: url.length });

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToCodeBlock(url, originalBlock);
  }

  /**
   * The inverse of "Convert URL to a card link": collapses the fenced block back to
   * `[title](url)` via a fresh fetch, the same title-only path the Markdown-link paste
   * mode uses (never spends microlink.io quota). A live fetch rather than reusing the
   * card's own stored title/host is deliberate: Twitch and Spotify build a richer label
   * (channel name, a localized phrase) that only their fetch handler produces and that
   * never gets persisted in the block, so reconstructing offline would silently downgrade
   * those every time.
   */
  /**
   * Reads one field out of a cardlink block's YAML. Title and the other text fields are
   * written JSON-quoted (see CodeBlockGenerator.yamlQuote), so a quoted value is parsed as
   * JSON rather than stripped naively - a title containing quotes survives intact.
   */
  private parseCardlinkField(lines: string[], blockStart: number, blockEnd: number, key: string): string | undefined {
    const re = new RegExp(`^${key}:\\s*(.+)$`);

    for (let i = blockStart + 1; i < blockEnd; i++) {
      const match = re.exec(lines[i] ?? "");
      if (!match) continue;

      const raw = (match[1] ?? "").trim();
      if (raw.startsWith(String.fromCharCode(34))) {
        try { return JSON.parse(raw) as string; } catch { /* fall through to a plain strip */ }
      }
      return raw.replace(/^["']|["']$/g, "");
    }
    return undefined;
  }

  /**
   * Turns a card back into `[title](url)`.
   *
   * Rebuilt from the block's own fields, with no request: a conversion changes the shape of
   * what is there, it does not go looking for newer data - that is what the refresh entries
   * are for. It also keeps the link saying exactly what the card said a moment earlier.
   *
   * The exception is the handful of sites whose inline label a fetch builds differently from
   * the card's title, which the block never records. Those re-fetch, and get the original
   * card block back untouched if that fails.
   */
  private async convertCardlinkToMarkdownLink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): Promise<void> {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;

    // Only the fenced lines themselves - unlike delete/refetch, a plain link needs none of
    // the blank-line padding a card wants, so leave what follows untouched.
    const lines = editor.getValue().split(/\r?\n/);
    const fenceLine = lines[range.blockEnd] ?? "";
    const blockEndPos = { line: range.blockEnd, ch: fenceLine.length };

    if (LinkMetadataFetcher.buildsRicherInlineLabel(range.url)) {
      // The selection doubles as convertUrlToMarkdownLink's restore-on-failure text
      editor.setSelection(range.startPos, blockEndPos);
      const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
      await codeBlockGenerator.convertUrlToMarkdownLink(range.url);
      return;
    }

    const blockStart = range.startPos.line;
    const title = this.parseCardlinkField(lines, blockStart, range.blockEnd, "title") ?? range.url;
    const host = this.parseCardlinkField(lines, blockStart, range.blockEnd, "host");
    const siteName = host ? LinkMetadataFetcher.siteNameFor(host) : undefined;

    editor.replaceRange(
      CodeBlockGenerator.buildMarkdownLink(title, range.url, siteName),
      range.startPos,
      blockEndPos
    );
  }

  private deleteCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): void {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;
    editor.replaceRange("", range.startPos, range.endPos);
  }

  private addLineAfterCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): void {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;
    const lines = editor.getValue().split(/\r?\n/);
    const fenceLine = lines[range.blockEnd] ?? "";
    editor.replaceRange("\n", { line: range.blockEnd, ch: fenceLine.length });
    editor.setCursor({ line: range.blockEnd + 1, ch: 0 });
  }

  /**
   * Re-fetches an existing `[text](url)` link's title in place. Deliberately not part of
   * "Convert URL to Markdown link", which takes bare URLs only: rewriting a link that is
   * already one is a refresh, not a conversion, and reads as a different action.
   */
  private async refreshMarkdownLink(editor: Editor, range: EditorRange): Promise<void> {
    const url = EditorExtensions.extractUrls(editor.getRange(range.from, range.to))[0]?.url;
    if (!url) return;

    // The selection doubles as the restore-on-failure text, so a failed fetch puts the
    // original link back untouched.
    editor.setSelection(range.from, range.to);
    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToMarkdownLink(url);
  }

  private async enhanceSelectedURL(editor: Editor, as: PasteShape = "card"): Promise<void> {
    // With nothing selected this also selects whatever link or URL is under the cursor,
    // which is what lets the menu item work from a plain right-click.
    const selectedText = EditorExtensions.getSelectedText(editor) || "";
    const selectionStart = editor.posToOffset(editor.getCursor("from"));
    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);

    // Turning a markdown link into a markdown link would only re-fetch its title, which is
    // not what the command says it does, so that shape takes bare URLs only.
    const matches = EditorExtensions.extractUrls(selectedText, { bareOnly: as === "markdown-link" });

    // Each conversion replaces the selection, so every URL has to be selected on its own
    // first: converting with the whole block still selected would swallow everything else
    // in it, including the links this shape deliberately skips.
    //
    // Replacing a span moves everything after it, so the offsets collected up front go
    // stale as we go. Rather than assume how far, measure it: the document's own length
    // says exactly, and stays right even when a conversion fails and restores its text.
    const blankLineBetween = this.settings?.blankLineBeforeCard ?? false;
    let shift = 0;

    for (const [index, match] of matches.entries()) {
      const lengthBefore = editor.getValue().length;
      const from = editor.offsetToPos(selectionStart + match.index + shift);
      const to = editor.offsetToPos(selectionStart + match.index + match.length + shift);
      editor.setSelection(from, to);

      if (as === "markdown-link") {
        await codeBlockGenerator.convertUrlToMarkdownLink(match.url);
      } else {
        // Only the last card keeps the line break that leaves a blank line below the group;
        // the ones above drop theirs so the cards stack instead of being spaced out one by
        // one. Converting in reading order also leaves the cursor on that final blank line,
        // outside every block, so the cards render instead of one staying as source.
        await codeBlockGenerator.convertUrlToCodeBlock(match.url, undefined, {
          trailingNewline: blankLineBetween || index === matches.length - 1,
        });
      }

      shift += editor.getValue().length - lengthBefore;
    }
  }

  private async manualPasteAndEnhanceURL(editor: Editor, as: PasteShape = "card"): Promise<void> {
    const clipboardText = await navigator.clipboard.readText();
    if (clipboardText == null || clipboardText == "") return;

    // Copying a link from a PDF, a mail client or a double-clicked line usually brings a
    // space or a newline along. The URL test is anchored at both ends, so that invisible
    // character alone made the paste look broken. Only the edges are trimmed: whitespace
    // inside the text still means it isn't a single URL, and is left to a plain paste.
    const url = clipboardText.trim();

    if (!navigator.onLine) {
      editor.replaceSelection(clipboardText);
      return;
    }

    if (!CheckIf.isUrl(url) || CheckIf.isImage(url)) {
      editor.replaceSelection(clipboardText);
      return;
    }

    await this.insertEnhancedUrl(editor, url, as);
  }

  /**
   * Writes the pasted URL in the requested shape. For a markdown link over a
   * selection there is nothing to fetch: the selected text becomes the link text,
   * which is Auto Link Title's behaviour and avoids a pointless request.
   */
  private async insertEnhancedUrl(editor: Editor, url: string, as: PasteShape): Promise<void> {
    if (as === "markdown-link" && editor.somethingSelected()) {
      const selection = editor.getSelection().trim();
      if (selection) {
        editor.replaceSelection(CodeBlockGenerator.buildMarkdownLink(selection, url));
        return;
      }
    }

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    if (as === "markdown-link") {
      await codeBlockGenerator.convertUrlToMarkdownLink(url);
    } else {
      await codeBlockGenerator.convertUrlToCodeBlock(url);
    }
  }

  private updateClipboardCache = async () => {
    try {
      this.cachedClipboard = (await navigator.clipboard.readText()).trim();
    } catch {
      // Clipboard permission unavailable — keep previous cached value
    }
  };

  private onPaste = async (evt: ClipboardEvent, editor: Editor): Promise<void> => {
    const shape = this.settings?.pasteAs ?? "none";
    if (shape === "none") return;
    if (!navigator.onLine) return;
    // Another plugin already claimed this paste (Auto Link Title and friends check the
    // same flag): without this both act on it, and which one wins is down to the order
    // the plugins happened to register in.
    if (evt.defaultPrevented) return;
    if (evt.clipboardData == null) return;
    if (evt.clipboardData.files.length > 0) return;

    const clipboardText = evt.clipboardData.getData("text/plain");
    if (clipboardText == null || clipboardText == "") return;

    const url = clipboardText.trim();
    this.cachedClipboard = url;

    if (!CheckIf.isUrl(url) || CheckIf.isImage(url)) return;

    evt.stopPropagation();
    evt.preventDefault();

    await this.insertEnhancedUrl(editor, url, shape);
  };

  private onDrop = async (evt: DragEvent, editor: Editor): Promise<void> => {
    const shape = this.settings?.dropAs ?? "none";
    if (shape === "none") return;
    if (!navigator.onLine) return;
    // Another handler already claimed this drop — don't fight it for the same content
    if (evt.defaultPrevented) return;
    if (evt.dataTransfer == null) return;
    if (evt.dataTransfer.files.length > 0) return;

    const dropText = evt.dataTransfer.getData("text/plain").trim();
    if (dropText == null || dropText == "") return;

    if (!CheckIf.isUrl(dropText) || CheckIf.isImage(dropText)) return;

    evt.stopPropagation();
    evt.preventDefault();

    // Obsidian has already moved the cursor to the drop point by the time this fires,
    // so the usual insert path puts the card where the URL was dropped.
    await this.insertEnhancedUrl(editor, dropText, shape);
  };

  private onEditorMenu = (menu: Menu, editor: Editor) => {
    let entryChosen = false;
    const cardlinkAtMouse = this.getCardlinkAtMouse();

    // Right-clicking a rendered cardlink moves the cursor into its block, which shifts
    // the layout underneath the pointer. Pin the card where it was.
    if (cardlinkAtMouse) this.stabilizeScroll();

    const cardlinkAtCursor = cardlinkAtMouse ?? this.getCardlinkUrlAtCursor(editor);

    // A right-click on a rendered card is not a click in the text: the cursor, and any
    // selection an earlier menu left behind, still point wherever they were. Detecting URLs
    // from them would offer to convert a link the pointer is nowhere near.
    const onCardlink = !!cardlinkAtCursor;

    // Deliberately not EditorExtensions.getSelectedText here: that one *sets* the selection
    // when there is none, and merely opening a context menu should not move it.
    const selection = !onCardlink && editor.somethingSelected() ? editor.getSelection() : undefined;
    const bareUrlAtCursor = onCardlink || selection ? undefined : this.getBareUrlAtCursor(editor);
    const linkAtCursor = onCardlink || selection ? undefined : this.getMarkdownLinkAtCursor(editor);
    // The link the pointer is on, which the entries below act on and which gets highlighted
    const target = bareUrlAtCursor ?? linkAtCursor;

    // Counted, not just detected: the entries say "URL" or "URLs" to match what they will act
    // on, since a selection can hold several and converting them all at once is easy to miss.
    const urlCount = selection
      ? EditorExtensions.extractUrls(selection).length
      : Number(!!bareUrlAtCursor || !!linkAtCursor);
    // A markdown link is already one, so only bare URLs can be converted into one.
    const bareUrlCount = selection
      ? EditorExtensions.extractUrls(selection, { bareOnly: true }).length
      : Number(!!bareUrlAtCursor);

    const online = navigator.onLine && !!this.settings?.showInMenuItem;
    // Requires a definitely-URL clipboard rather than defaulting to "show it" when the
    // cache is still empty (permission not yet granted, or no focus/right-click event has
    // populated it yet) — an unrelated copy or an image clipboard now hides the item.
    // Not while there is anything to convert. On a card the paste would land wherever the
    // cursor was left, which a right-click on a rendered card never updates - possibly
    // inside the block. On a URL, a markdown link or a selection holding either, it would
    // replace what the convert entries are offering to act on, since a paste consumes the
    // selection. Offering both, one destroying the other's subject, reads as a trap.
    const canPaste = online && !onCardlink && urlCount === 0
      && CheckIf.isUrl(this.cachedClipboard) && !CheckIf.isImage(this.cachedClipboard);
    const canConvertToCard = online && urlCount > 0;
    const canConvertToMarkdown = online && bareUrlCount > 0;

    if (!cardlinkAtCursor && !canPaste && !canConvertToCard) return;

    // Highlight the link the entries will act on, so it is clear which one was picked when
    // several sit on the same line. Undone when the menu closes without a choice: showing a
    // menu shouldn't be able to change the selection on its own.
    if (canConvertToCard && target) {
      const cursor = editor.getCursor();
      editor.setSelection(target.from, target.to);
      menu.onHide(() => {
        // Deferred so a click on an entry has already flipped the flag by the time this runs
        window.setTimeout(() => {
          if (!entryChosen) editor.setSelection(cursor, cursor);
        }, 0);
      });
    }

    menu.addSeparator();

    if (cardlinkAtCursor) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Refresh card link")
          .setIcon("refresh-cw")
          .onClick(() => {
            void this.withPreservedScroll(() => this.refetchCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor));
          });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Delete card link")
          .setIcon("trash")
          .onClick(() => {
            void this.withPreservedScroll(() => { this.deleteCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor); });
          });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Add line after card link")
          .setIcon("arrow-down")
          .onClick(() => {
            void this.withPreservedScroll(() => { this.addLineAfterCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor); });
          });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Convert card to Markdown link")
          .setIcon("link")
          .onClick(() => {
            void this.withPreservedScroll(() => this.convertCardlinkToMarkdownLink(editor, cardlinkAtMouse ?? cardlinkAtCursor));
          });
      });
    }

    // Fixed order, never reordered to follow the "Paste as" setting: a menu that rearranges
    // itself costs more in muscle memory than an entry sitting in the less-used position.
    if (canPaste) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Paste URL to a Markdown link")
          .setIcon("link")
          .onClick(() => { void this.withPreservedScroll(() => this.manualPasteAndEnhanceURL(editor, "markdown-link")); });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Paste URL to a card link")
          .setIcon("rectangle-horizontal")
          .onClick(() => { void this.withPreservedScroll(() => this.manualPasteAndEnhanceURL(editor)); });
      });
    }

    if (online && linkAtCursor) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Refresh Markdown link")
          .setIcon("refresh-cw")
          .onClick(() => {
            entryChosen = true;
            void this.withPreservedScroll(() => this.refreshMarkdownLink(editor, linkAtCursor));
          });
      });
    }

    if (canConvertToMarkdown) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle(`Convert ${bareUrlCount > 1 ? "URLs" : "URL"} to Markdown link`)
          .setIcon("link")
          .onClick(() => { entryChosen = true; void this.withPreservedScroll(() => this.enhanceSelectedURL(editor, "markdown-link")); });
      });
    }

    if (canConvertToCard) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle(`Convert ${urlCount > 1 ? "URLs" : "URL"} to card link`)
          .setIcon("rectangle-horizontal")
          .onClick(() => { entryChosen = true; void this.withPreservedScroll(() => this.enhanceSelectedURL(editor)); });
      });
    }
  };

  private async loadSettings() {
    const stored = await this.loadData() as (Partial<ObsidianAutoCardLinkSettings> & LegacyEnhanceSettings) | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    await this.migrateEnhanceToggles(stored);
  }

  /**
   * "Enhance default paste"/"drop" used to be toggles beside a two-way shape dropdown, which
   * left a meaningless state on disk: enhancement off, yet a shape recorded. The shape now
   * carries the off state itself, as "none".
   *
   * Without this, everyone who had left the toggles off - the default, so nearly everyone -
   * would silently get their pasted URLs turned into cards after updating, since only the
   * discarded toggle said not to. The keys are removed once converted, so a later choice of
   * "none" is never mistaken for an old toggle and rewritten.
   */
  private async migrateEnhanceToggles(stored: LegacyEnhanceSettings | null): Promise<void> {
    if (!this.settings || !stored) return;

    const hadPaste = "enhanceDefaultPaste" in stored;
    const hadDrop = "enhanceDefaultDrop" in stored;
    if (!hadPaste && !hadDrop) return;

    if (hadPaste && stored.enhanceDefaultPaste !== true) this.settings.pasteAs = "none";
    if (hadDrop && stored.enhanceDefaultDrop !== true) this.settings.dropAs = "none";

    // Object.assign carried the legacy keys into the live settings, so they would be written
    // straight back and re-trigger this on every launch, undoing whatever the reader picks.
    const withLegacy = this.settings as ObsidianAutoCardLinkSettings & LegacyEnhanceSettings;
    delete withLegacy.enhanceDefaultPaste;
    delete withLegacy.enhanceDefaultDrop;

    await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}