import { App, parseYaml, Notice, ButtonComponent, getLinkpath } from "obsidian";

import { YamlParseError, NoRequiredParamsError } from "./errors";
import { LinkMetadata } from "./interfaces";
import { CheckIf } from "./checkif";

export class CodeBlockProcessor {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  async run(source: string, el: HTMLElement) {
    try {
      const data = this.parseLinkMetadataFromYaml(source);
      this.genLinkEl(data, el);
    } catch (error) {
      if (error instanceof NoRequiredParamsError) {
        this.genErrorEl(error.message, el);
      } else if (error instanceof YamlParseError) {
        this.genErrorEl(error.message, el);
      } else if (error instanceof TypeError) {
        this.genErrorEl("internal links must be surrounded by quotes.", el);
        console.error(error);
      } else {
        console.error("Code Block: cardlink unknown error", error);
      }
    }
  }

  private parseLinkMetadataFromYaml(source: string): LinkMetadata {
    let yaml: Partial<LinkMetadata>;

    let indent = -1;
    source = source
      .split(/\r?\n|\r|\n/g)
      .map((line) =>
        line.replace(/^\t+/g, (tabs) => {
          const n = tabs.length;
          if (indent < 0) {
            indent = n;
          }
          return " ".repeat(n);
        })
      )
      .join("\n");

    try {
      yaml = parseYaml(source) as Partial<LinkMetadata>;
    } catch (error) {
      console.error(error);
      throw new YamlParseError(
        "failed to parse yaml. Check debug console for more detail."
      );
    }

    if (!yaml || !yaml.url || !yaml.title) {
      throw new NoRequiredParamsError(
        "required params[url, title] are not found."
      );
    }

    return {
      url: yaml.url,
      title: yaml.title,
      author: yaml.author,
      description: yaml.description,
      host: yaml.host,
      favicon: yaml.favicon,
      image: yaml.image,
      duration: yaml.duration,
      indent,
    };
  }

  private genErrorEl(errorMsg: string, parentEl: HTMLElement): void {
    const containerEl = parentEl.createDiv({ cls: "auto-card-link-error-container" });
    containerEl.createSpan({ text: `cardlink error: ${errorMsg}` });
  }

  private genLinkEl(data: LinkMetadata, parentEl: HTMLElement): void {
    const containerEl = parentEl.createDiv({ cls: "auto-card-link-container" });
    containerEl.setAttr("data-auto-card-link-depth", data.indent);

    const cardEl = containerEl.createEl("a", {
      cls: "auto-card-link-card",
      href: data.url,
      attr: { target: "_blank" },
    });

    // Note: mainEl must be created before the thumbnail — the card uses
    // flex-direction: row-reverse, so the later child renders on the left.
    const mainEl = cardEl.createDiv({ cls: "auto-card-link-main" });

    mainEl.createDiv({ cls: "auto-card-link-title", text: data.title });

    if (data.description) {
      mainEl.createDiv({ cls: "auto-card-link-description", text: data.description });
    }

    const hostEl = mainEl.createDiv({ cls: "auto-card-link-host" });

    if (data.favicon) {
      if (!CheckIf.isUrl(data.favicon))
        data.favicon = this.getLocalImagePath(data.favicon);

      const faviconEl = hostEl.createEl("img", {
        cls: "auto-card-link-favicon",
        attr: { src: data.favicon },
      });

      // Fallback to Google favicon service if direct URL fails to load
      if (data.host) {
        const fallbackUrl = `https://www.google.com/s2/favicons?domain=${data.host}&sz=32`;
        faviconEl.onerror = () => {
          if (faviconEl.src !== fallbackUrl) {
            faviconEl.src = fallbackUrl;
          }
        };
      }
    }

    if (data.host) {
      hostEl.createSpan({ text: data.host });
    }

    if (data.author) {
      hostEl.createSpan({ cls: "auto-card-link-author", text: `· ${data.author}` });
    }

    if (data.image) {
      if (!CheckIf.isUrl(data.image))
        data.image = this.getLocalImagePath(data.image);

      const thumbnailWrapEl = cardEl.createDiv({ cls: "auto-card-link-thumbnail-wrap" });

      const thumbnailEl = thumbnailWrapEl.createEl("img", {
        cls: "auto-card-link-thumbnail",
        attr: { src: data.image, draggable: "false" },
      });

      // If the image URL is dead (expired signed URL, 404, hotlink block, …),
      // drop the whole thumbnail so the card collapses to a clean text-only layout
      // instead of showing the browser's broken-image glyph.
      thumbnailEl.onerror = () => {
        thumbnailWrapEl.remove();
      };

      if (data.duration) {
        thumbnailWrapEl.createSpan({ cls: "auto-card-link-duration", text: data.duration });
      }
    }

    new ButtonComponent(containerEl)
      .setClass("auto-card-link-copy-url")
      .setClass("clickable-icon")
      .setIcon("copy")
      .setTooltip(`Copy URL\n${data.url}`)
      .onClick(() => {
        void navigator.clipboard.writeText(data.url);
        new Notice("URL copied to your clipboard");
      });
  }

  private getLocalImagePath(link: string): string {
    link = link.slice(2, -2); // remove [[]]
    const imageRelativePath = this.app.metadataCache.getFirstLinkpathDest(
      getLinkpath(link),
      ""
    )?.path;

    if (!imageRelativePath) return link;

    return this.app.vault.adapter.getResourcePath(imageRelativePath);
  }
}
