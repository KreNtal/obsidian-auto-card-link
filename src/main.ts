import { Plugin, MarkdownView, Editor, Menu, MenuItem, Notice } from "obsidian";

import {
  ObsidianAutoCardLinkSettings,
  ObsidianAutoCardLinkSettingTab,
  DEFAULT_SETTINGS,
  applyThumbnailPosition,
  applyCardStyle
} from "./settings";

import { EditorExtensions } from "./editor_enhancements";
import { CheckIf } from "./checkif";
import { CodeBlockGenerator } from "./code_block_generator";
import { CodeBlockProcessor } from "./code_block_processor";
import { linkRegex } from "./regex";

export default class ObsidianAutoCardLink extends Plugin {
  settings?: ObsidianAutoCardLinkSettings;
  private cachedClipboard = "";
  private savedScrollTop = 0;
  private refreshQueue = Promise.resolve();
  private refreshQueueDepth = 0;

  async onload() {
    await this.loadSettings();
    this.registerDomEvent(window, "focus", this.updateClipboardCache);
    this.registerDomEvent(document, "contextmenu", this.updateClipboardCache);
    // Capture scroll position before Obsidian's mousedown handler moves the cursor
    this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
      if (e.button !== 2) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const scroller = view?.containerEl.querySelector(".cm-scroller");
      if (scroller) this.savedScrollTop = (scroller as HTMLElement).scrollTop;
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

    this.registerEvent(this.app.workspace.on("editor-paste", this.onPaste));
    this.registerEvent(this.app.workspace.on("editor-menu", this.onEditorMenu));
    this.addSettingTab(new ObsidianAutoCardLinkSettingTab(this.app, this));
  }

  private getCardlinkAtMouse(): { url: string; lineStart: number; lineEnd: number; } | undefined {
    // Use :hover on the element itself, not as a descendant selector
    const el = document.querySelector(".auto-card-link-container[data-cardlink-url]:hover");
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
  ): void {
    this.refreshQueueDepth++;
    if (this.refreshQueueDepth > 1) {
      new Notice(`Refresh queued — ${this.refreshQueueDepth - 1} already in progress`);
    }
    this.refreshQueue = this.refreshQueue
      .then(() => this.doRefetchCardlink(editor, cardlink))
      .catch(() => { })
      .finally(() => { this.refreshQueueDepth--; });
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

  private async enhanceSelectedURL(editor: Editor): Promise<void> {
    const selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);

    for (const line of selectedText.split(/[\n ]/)) {
      if (CheckIf.isUrl(line)) {
        await codeBlockGenerator.convertUrlToCodeBlock(line);
      } else if (CheckIf.isLinkedUrl(line)) {
        const url = this.getUrlFromLink(line);
        await codeBlockGenerator.convertUrlToCodeBlock(url);
      }
    }
  }

  private async manualPasteAndEnhanceURL(editor: Editor): Promise<void> {
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

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToCodeBlock(clipboardText);
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
    if (evt.clipboardData == null) return;
    if (evt.clipboardData.files.length > 0) return;

    const clipboardText = evt.clipboardData.getData("text/plain");
    if (clipboardText == null || clipboardText == "") return;

    this.cachedClipboard = clipboardText;

    if (!CheckIf.isUrl(clipboardText) || CheckIf.isImage(clipboardText)) return;

    evt.stopPropagation();
    evt.preventDefault();

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToCodeBlock(clipboardText);
  };

  private onEditorMenu = (menu: Menu, editor: Editor) => {
    const cardlinkAtMouse = this.getCardlinkAtMouse();

    // When right-clicking a rendered cardlink, Obsidian moves the cursor and scrolls
    // to it (often back to line 1). Restore the scroll position saved on contextmenu.
    if (cardlinkAtMouse) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const scroller = view?.containerEl.querySelector(".cm-scroller");
      if (scroller) {
        const top = this.savedScrollTop;
        window.requestAnimationFrame(() => {
          (scroller as HTMLElement).scrollTop = top;
        });
      }
    }

    const cardlinkAtCursor = cardlinkAtMouse ?? this.getCardlinkUrlAtCursor(editor);

    const selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    const hasSelectedUrl = selectedText.split(/[\n ]/).some(
      (line) => CheckIf.isUrl(line) || CheckIf.isLinkedUrl(line)
    );

    const online = navigator.onLine && !!this.settings?.showInMenuItem;
    const canPaste = online && (this.cachedClipboard === "" || (CheckIf.isUrl(this.cachedClipboard) && !CheckIf.isImage(this.cachedClipboard)));
    const canEnhance = online && hasSelectedUrl;

    if (!cardlinkAtCursor && !canPaste && !canEnhance) return;

    menu.addSeparator();

    if (cardlinkAtCursor) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Refresh Card Link")
          .setIcon("refresh-cw")
          .onClick(() => {
            this.refetchCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor);
          });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Delete Card Link")
          .setIcon("trash")
          .onClick(() => {
            this.deleteCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor);
          });
      });
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Add line after card link")
          .setIcon("arrow-down")
          .onClick(() => {
            this.addLineAfterCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor);
          });
      });
    }

    if (canPaste) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Paste URL to a Card Link")
          .setIcon("paste")
          .onClick(async () => { await this.manualPasteAndEnhanceURL(editor); });
      });
    }

    if (canEnhance) {
      menu.addItem((item: MenuItem) => {
        item
          .setTitle("Convert selected URL to Card Link")
          .setIcon("link")
          .onClick(() => { void this.enhanceSelectedURL(editor); });
      });
    }
  };

  private getUrlFromLink(link: string): string {
    const urlRegex = new RegExp(linkRegex);
    const regExpExecArray = urlRegex.exec(link);
    if (regExpExecArray === null || regExpExecArray.length < 2) return "";
    return regExpExecArray[2] ?? "";
  }

  onunload() {
    console.log("unloading auto-card-link");
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}