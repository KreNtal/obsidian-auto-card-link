import { Plugin, MarkdownView, Editor, Menu, MenuItem, Notice } from "obsidian";

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
import { CodeBlockProcessor } from "./code_block_processor";
import { linkRegex, linkLineRegex } from "./regex";

type PasteShape = "card" | "markdown-link";

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
  private getMarkdownLinkAtCursor(
    editor: Editor
  ): { url: string; startPos: { line: number; ch: number; }; endPos: { line: number; ch: number; }; } | undefined {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const regex = new RegExp(linkLineRegex);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const url = match[2];
      if (url && cursor.ch >= start && cursor.ch <= end) {
        return { url, startPos: { line: cursor.line, ch: start }, endPos: { line: cursor.line, ch: end } };
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
  private async convertCardlinkToMarkdownLink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): Promise<void> {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;

    // Select only the fenced lines themselves — unlike delete/refetch, a plain link needs
    // none of the blank-line padding a card wants, so leave what follows untouched. The
    // selection also becomes convertUrlToMarkdownLink's restore-on-failure fallback text,
    // so a failed or offline fetch leaves the original card block exactly as it was.
    const lines = editor.getValue().split(/\r?\n/);
    const fenceLine = lines[range.blockEnd] ?? "";
    editor.setSelection(range.startPos, { line: range.blockEnd, ch: fenceLine.length });

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToMarkdownLink(range.url);
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

  private async convertMarkdownLinkToCard(
    editor: Editor,
    link: { url: string; startPos: { line: number; ch: number; }; endPos: { line: number; ch: number; }; }
  ): Promise<void> {
    editor.setSelection(link.startPos, link.endPos);
    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToCodeBlock(link.url);
  }

  private async enhanceSelectedURL(editor: Editor, as: PasteShape = "card"): Promise<void> {
    const selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    const convert = (url: string) => as === "markdown-link"
      ? codeBlockGenerator.convertUrlToMarkdownLink(url)
      : codeBlockGenerator.convertUrlToCodeBlock(url);

    for (const line of selectedText.split(/[\n ]/)) {
      if (CheckIf.isUrl(line)) {
        await convert(line);
      } else if (CheckIf.isLinkedUrl(line)) {
        await convert(this.getUrlFromLink(line));
      }
    }
  }

  private async manualPasteAndEnhanceURL(editor: Editor, as: PasteShape = "card"): Promise<void> {
    const clipboardText = await navigator.clipboard.readText();
    if (clipboardText == null || clipboardText == "") return;

    if (!navigator.onLine) {
      editor.replaceSelection(clipboardText);
      return;
    }

    if (!CheckIf.isUrl(clipboardText) || CheckIf.isImage(clipboardText)) {
      editor.replaceSelection(clipboardText);
      return;
    }

    await this.insertEnhancedUrl(editor, clipboardText, as);
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
      this.cachedClipboard = await navigator.clipboard.readText();
    } catch {
      // Clipboard permission unavailable — keep previous cached value
    }
  };

  private onPaste = async (evt: ClipboardEvent, editor: Editor): Promise<void> => {
    if (!this.settings?.enhanceDefaultPaste) return;
    if (!navigator.onLine) return;
    // Another plugin already claimed this paste (Auto Link Title and friends check the
    // same flag): without this both act on it, and which one wins is down to the order
    // the plugins happened to register in.
    if (evt.defaultPrevented) return;
    if (evt.clipboardData == null) return;
    if (evt.clipboardData.files.length > 0) return;

    const clipboardText = evt.clipboardData.getData("text/plain");
    if (clipboardText == null || clipboardText == "") return;

    this.cachedClipboard = clipboardText;

    if (!CheckIf.isUrl(clipboardText) || CheckIf.isImage(clipboardText)) return;

    evt.stopPropagation();
    evt.preventDefault();

    await this.insertEnhancedUrl(editor, clipboardText, this.settings.pasteAs ?? "card");
  };

  private onDrop = async (evt: DragEvent, editor: Editor): Promise<void> => {
    if (!this.settings?.enhanceDefaultDrop) return;
    if (!navigator.onLine) return;
    // Another handler already claimed this drop — don't fight it for the same content
    if (evt.defaultPrevented) return;
    if (evt.dataTransfer == null) return;
    if (evt.dataTransfer.files.length > 0) return;

    const dropText = evt.dataTransfer.getData("text/plain");
    if (dropText == null || dropText == "") return;

    if (!CheckIf.isUrl(dropText) || CheckIf.isImage(dropText)) return;

    evt.stopPropagation();
    evt.preventDefault();

    // Obsidian has already moved the cursor to the drop point by the time this fires,
    // so the usual insert path puts the card where the URL was dropped.
    await this.insertEnhancedUrl(editor, dropText, this.settings.dropAs ?? "card");
  };

  private onEditorMenu = (menu: Menu, editor: Editor) => {
    const cardlinkAtMouse = this.getCardlinkAtMouse();

    // Right-clicking a rendered cardlink moves the cursor into its block, which shifts
    // the layout underneath the pointer. Pin the card where it was.
    if (cardlinkAtMouse) this.stabilizeScroll();

    const cardlinkAtCursor = cardlinkAtMouse ?? this.getCardlinkUrlAtCursor(editor);
    const markdownLinkAtCursor = cardlinkAtCursor ? undefined : this.getMarkdownLinkAtCursor(editor);

    const selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    const hasSelectedUrl = selectedText.split(/[\n ]/).some(
      (line) => CheckIf.isUrl(line) || CheckIf.isLinkedUrl(line)
    );

    const online = navigator.onLine && !!this.settings?.showInMenuItem;
    // Requires a definitely-URL clipboard rather than defaulting to "show it" when the
    // cache is still empty (permission not yet granted, or no focus/right-click event has
    // populated it yet) — an unrelated copy or an image clipboard now hides the item.
    const canPaste = online && CheckIf.isUrl(this.cachedClipboard) && !CheckIf.isImage(this.cachedClipboard);
    const canEnhance = online && hasSelectedUrl;
    const canConvertLink = online && !!markdownLinkAtCursor;

    if (!cardlinkAtCursor && !canPaste && !canEnhance && !canConvertLink) return;

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
          .setTitle("Convert card to normal link")
          .setIcon("unlink")
          .onClick(() => {
            void this.withPreservedScroll(() => this.convertCardlinkToMarkdownLink(editor, cardlinkAtMouse ?? cardlinkAtCursor));
          });
      });
    }

    if (canPaste) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Paste URL to a card link")
          .setIcon("paste")
          .onClick(() => { void this.withPreservedScroll(() => this.manualPasteAndEnhanceURL(editor)); });
      });
    }

    if (canEnhance) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Convert selected URL to card link")
          .setIcon("link")
          .onClick(() => { void this.withPreservedScroll(() => this.enhanceSelectedURL(editor)); });
      });
    }

    if (canConvertLink && markdownLinkAtCursor) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Convert URL to card link")
          .setIcon("link")
          .onClick(() => { void this.withPreservedScroll(() => this.convertMarkdownLinkToCard(editor, markdownLinkAtCursor)); });
      });
    }
  };

  private getUrlFromLink(link: string): string {
    const urlRegex = new RegExp(linkRegex);
    const regExpExecArray = urlRegex.exec(link);
    if (regExpExecArray === null || regExpExecArray.length < 2) return "";
    return regExpExecArray[2] ?? "";
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ObsidianAutoCardLinkSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}