import { Plugin, MarkdownView, Editor, Menu, MenuItem } from "obsidian";

import {
  ObsidianAutoCardLinkSettings,
  ObsidianAutoCardLinkSettingTab,
  DEFAULT_SETTINGS,
  applyThumbnailPosition
} from "./settings";

import { EditorExtensions } from "./editor_enhancements";
import { CheckIf } from "./checkif";
import { CodeBlockGenerator } from "./code_block_generator";
import { CodeBlockProcessor } from "./code_block_processor";
import { linkRegex } from "./regex";

export default class ObsidianAutoCardLink extends Plugin {
  settings?: ObsidianAutoCardLinkSettings;
  private cachedClipboard = "";

  async onload() {
    await this.loadSettings();
    this.registerDomEvent(window, "focus", this.updateClipboardCache);
    this.registerDomEvent(document, "contextmenu", this.updateClipboardCache);

    this.registerMarkdownCodeBlockProcessor("cardlink", async (source, el, ctx) => {
      const processor = new CodeBlockProcessor(this.app);
      await processor.run(source, el);

      const info = ctx.getSectionInfo(el);
      const urlMatch = source.match(/^url:\s*(.+)$/m);
      const url = urlMatch?.[1]?.trim().replace(/^["']|["']$/g, "");

      if (info && url) {
        const container = el.querySelector(".auto-card-link-container") as HTMLElement | null;
        if (container) {
          container.dataset.cardlinkUrl = url;
          container.dataset.cardlinkLineStart = String(info.lineStart);
          container.dataset.cardlinkLineEnd = String(info.lineEnd);
        }
      }
    });

    applyThumbnailPosition(this.settings?.thumbnailPosition ?? "left");

    this.addCommand({
      id: "auto-card-link-paste-and-enhance",
      name: "Paste URL and enhance to card link",
      editorCallback: async (editor: Editor) => {
        await this.manualPasteAndEnhanceURL(editor);
      },
      hotkeys: [],
    });

    this.addCommand({
      id: "auto-card-link-enhance-selected-url",
      name: "Enhance selected URL to card link",
      editorCheckCallback: (checking: boolean, editor: Editor) => {
        if (!navigator.onLine) return false;
        if (checking) return true;
        this.enhanceSelectedURL(editor);
        return true;
      },
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "e",
        },
      ],
    });

    this.registerEvent(this.app.workspace.on("editor-paste", this.onPaste));
    this.registerEvent(this.app.workspace.on("editor-menu", this.onEditorMenu));
    this.addSettingTab(new ObsidianAutoCardLinkSettingTab(this.app, this));
  }

  private getCardlinkAtMouse(): { url: string; lineStart: number; lineEnd: number; } | undefined {
    // Use :hover on the element itself, not as a descendant selector
    const el = document.querySelector(".auto-card-link-container[data-cardlink-url]:hover");
    if (!el || !(el instanceof HTMLElement)) return;

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
  ): { url: string; startPos: { line: number; ch: number }; endPos: { line: number; ch: number }; } | undefined {
    const url = typeof cardlink === "string" ? cardlink : cardlink.url;
    const lines = editor.getValue().split(/\r?\n/);

    let blockStart = -1;
    let blockEnd = -1;

    if (typeof cardlink === "object") {
      blockStart = cardlink.lineStart;
      blockEnd = cardlink.lineEnd;
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

    return { url, startPos, endPos };
  }

  private async refetchCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): Promise<void> {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;
    const { url, startPos, endPos } = range;

    editor.replaceRange(url, startPos, endPos);
    editor.setCursor(startPos);
    editor.setSelection(startPos, { line: startPos.line, ch: url.length });

    const codeBlockGenerator = new CodeBlockGenerator(editor, this.app, this.settings);
    await codeBlockGenerator.convertUrlToCodeBlock(url);
  }

  private deleteCardlink(
    editor: Editor,
    cardlink: string | { url: string; lineStart: number; lineEnd: number; }
  ): void {
    const range = this.resolveCardlinkRange(editor, cardlink);
    if (!range) return;
    editor.replaceRange("", range.startPos, range.endPos);
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
          .onClick(async () => {
            await this.refetchCardlink(editor, cardlinkAtMouse ?? cardlinkAtCursor);
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
          .onClick(() => { this.enhanceSelectedURL(editor); });
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