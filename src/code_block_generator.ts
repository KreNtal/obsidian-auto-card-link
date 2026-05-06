import { Editor, Notice, requestUrl } from "obsidian";

import { LinkMetadata } from "src/interfaces";
import { EditorExtensions } from "src/editor_enhancements";
import { LinkMetadataFetcher } from "src/link_metadata_fetcher";

export class CodeBlockGenerator {
  editor: Editor;
  private fetcher = new LinkMetadataFetcher();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  async convertUrlToCodeBlock(url: string): Promise<void> {
    const selectedText = this.editor.getSelection();
    const pasteId = this.createBlockHash();
    const fetchingText = `[Fetching Data#${pasteId}](${url})`;

    this.editor.replaceSelection(fetchingText);

    try {
      const linkMetadata = await this.fetchLinkMetadata(url);

      const text = this.editor.getValue();
      const start = text.indexOf(fetchingText);

      if (start < 0) {
        console.log(`Unable to find text "${fetchingText}" in current editor, bailing out; link ${url}`);
        return;
      }

      const end = start + fetchingText.length;
      const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
      const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);

      if (!linkMetadata) {
        new Notice("Couldn't fetch link metadata");
        this.editor.replaceRange(selectedText || `[${url}](${url})`, startPos, endPos);
        return;
      }

      this.editor.replaceRange(this.genCodeBlock(linkMetadata), startPos, endPos);
    } catch (e) {
      console.error("convertUrlToCodeBlock failed:", e);
      new Notice("Couldn't fetch link metadata");

      // find and revert the placeholder
      const text = this.editor.getValue();
      const start = text.indexOf(fetchingText);
      if (start >= 0) {
        const end = start + fetchingText.length;
        const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
        const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);
        this.editor.replaceRange(selectedText || `[${url}](${url})`, startPos, endPos);
      }
    }
  }

  genCodeBlock(linkMetadata: LinkMetadata): string {
    const codeBlockTexts = ["\n```cardlink"];
    codeBlockTexts.push(`url: ${linkMetadata.url}`);
    codeBlockTexts.push(`title: "${linkMetadata.title}"`);
    if (linkMetadata.description)
      codeBlockTexts.push(`description: "${linkMetadata.description}"`);
    if (linkMetadata.host) codeBlockTexts.push(`host: ${linkMetadata.host}`);
    if (linkMetadata.favicon)
      codeBlockTexts.push(`favicon: ${linkMetadata.favicon}`);
    if (linkMetadata.image) codeBlockTexts.push(`image: ${linkMetadata.image}`);
    codeBlockTexts.push("```\n");
    return codeBlockTexts.join("\n");
  }

  private createBlockHash(): string {
    let result = "";
    const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < 4; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  private async fetchLinkMetadata(url: string): Promise<LinkMetadata | undefined> {
    return this.fetcher.fetch(url);  // ← replaces everything that was here
  }
}
