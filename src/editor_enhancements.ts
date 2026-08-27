import { Editor, EditorPosition } from "obsidian";

import { linkLineRegex, lineRegex } from "./regex";

/** A URL found in a block of text, with the span it occupies. */
export interface UrlMatch {
  /** Offset of the span within the searched text */
  index: number;
  /** Length of the span: the whole `[text](url)` for a link, the URL itself when bare */
  length: number;
  url: string;
}

interface WordBoundaries {
  start: { line: number; ch: number };
  end: { line: number; ch: number };
}

export class EditorExtensions {
  public static getSelectedText(editor: Editor): string {
    if (!editor.somethingSelected()) {
      const wordBoundaries = this.getWordBoundaries(editor);
      editor.setSelection(wordBoundaries.start, wordBoundaries.end);
    }
    return editor.getSelection();
  }

  /**
   * Every URL in a block of text, in document order: the target of each `[text](url)`
   * link, plus the bare URLs outside them.
   *
   * Splitting the text on whitespace instead (what this used to do) tore apart any link
   * whose text contained a space - which is most of them, and all of the ones this plugin
   * generates - so those were silently skipped.
   */
  public static extractUrls(
    text: string,
    options?: { bareOnly?: boolean; markdownOnly?: boolean; }
  ): UrlMatch[] {
    const found: UrlMatch[] = [];
    const linkRanges: Array<[number, number]> = [];

    for (const match of text.matchAll(linkLineRegex)) {
      const index = match.index ?? 0;
      linkRanges.push([index, index + match[0].length]);
      // The whole `[text](url)` is the span to replace, not just its target
      if (match[2] && !options?.bareOnly) found.push({ index, length: match[0].length, url: match[2] });
    }

    // markdownOnly is the mirror of bareOnly, for the one direction that only applies to
    // links that already are one: stripping `[text](url)` back down to its target.
    if (!options?.markdownOnly) {
      for (const match of text.matchAll(lineRegex)) {
        const index = match.index ?? 0;
        // Skip the URL sitting inside a markdown link's parentheses: it is the same link
        const insideLink = linkRanges.some(([from, to]) => index >= from && index < to);
        if (!insideLink) found.push({ index, length: match[0].length, url: match[0] });
      }
    }

    return found.sort((a, b) => a.index - b.index);
  }

  private static isCursorWithinBoundaries(
    cursor: EditorPosition,
    match: RegExpMatchArray
  ): boolean {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;
    return startIndex <= cursor.ch && cursor.ch <= endIndex;
  }

  private static getWordBoundaries(editor: Editor): WordBoundaries {
    const cursor = editor.getCursor();

    // If its a normal URL token this is not a markdown link
    // In this case we can simply overwrite the link boundaries as-is
    const lineText = editor.getLine(cursor.line);
    // First check if we're in a link
    const linksInLine = lineText.matchAll(linkLineRegex);

    for (const match of linksInLine) {
      if (this.isCursorWithinBoundaries(cursor, match)) {
        const startCh = match.index ?? 0;
        return {
          start: {
            line: cursor.line,
            ch: startCh,
          },
          end: { line: cursor.line, ch: startCh + match[0].length },
        };
      }
    }

    // If not, check if we're in just a standard ol' URL.
    const urlsInLine = lineText.matchAll(lineRegex);

    for (const match of urlsInLine) {
      if (this.isCursorWithinBoundaries(cursor, match)) {
        const startCh = match.index ?? 0;
        return {
          start: { line: cursor.line, ch: startCh },
          end: { line: cursor.line, ch: startCh + match[0].length },
        };
      }
    }

    return {
      start: cursor,
      end: cursor,
    };
  }

  public static getEditorPositionFromIndex(
    content: string,
    index: number
  ): EditorPosition {
    const substr = content.substring(0, index);

    let l = 0;
    let offset = -1;
    let r = -1;
    for (; (r = substr.indexOf("\n", r + 1)) !== -1; l++, offset = r);
    offset += 1;

    const ch = content.substring(offset, index).length;

    return { line: l, ch: ch };
  }
}
