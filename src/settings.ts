import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder, setIcon } from "obsidian";
import ObsidianAutoCardLink from "./main";

class FolderSuggest extends AbstractInputSuggest<string> {
  private folders: string[];
  private input: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.input = inputEl;
    this.folders = ["/"].concat(
      this.app.vault.getAllLoadedFiles()
        .filter((f): f is TFolder => f instanceof TFolder)
        .map(f => f.path)
    );
  }

  getSuggestions(query: string): string[] {
    const lower = query.toLowerCase();
    return this.folders.filter(f => f.toLowerCase().includes(lower));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.createDiv({ text: folder });
  }

  selectSuggestion(folder: string): void {
    this.input.value = folder;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

/** "none" leaves the event alone; the label calls it "Plain URL". */
export type OutputShape = "none" | "markdown-link" | "card";

export interface ObsidianAutoCardLinkSettings {
  pasteAs: OutputShape;
  dropAs: OutputShape;
  showInMenuItem: boolean;
  blankLineBeforeCard: boolean;
  thumbnailPosition: "left" | "right";
  downloadImages: boolean;
  imageFolder: string;
  downloadFavicons: boolean;
  faviconFolder: string;
  cardStyle: "classic" | "modern" | "glass" | "compact";
  thumbnailQuality: "better-preview" | "max-resolution";
  useExternalFallback: boolean;
  thumbnailFit: "cover" | "contain";
}

export const DEFAULT_SETTINGS: ObsidianAutoCardLinkSettings = {
  pasteAs: "none",
  dropAs: "none",
  showInMenuItem: true,
  blankLineBeforeCard: false,
  thumbnailPosition: "left",
  downloadImages: false,
  imageFolder: "AutoCardLink/images",
  downloadFavicons: false,
  faviconFolder: "AutoCardLink/favicons",
  cardStyle: "classic",
  thumbnailQuality: "better-preview",
  useExternalFallback: false,
  thumbnailFit: "cover",
};

export class ObsidianAutoCardLinkSettingTab extends PluginSettingTab {
  plugin: ObsidianAutoCardLink;

  constructor(app: App, plugin: ObsidianAutoCardLink) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Plugins that also turn a pasted or dropped URL into an inline markdown link, and so
   * compete for the same event when our own output shape is set to one.
   *
   * Detection has to go by known id: nothing in the API reports which plugins listen to
   * an editor event, so a generic "someone else handles this" check isn't possible.
   */
  private static readonly COMPETING_PLUGIN_IDS = [
    "obsidian-auto-link-title",
    "url-into-selection",
    "obsidian-link-embed",
  ];

  /**
   * `plugins` is real on the App instance but absent from the public typings, so read it
   * through a narrow local shape rather than `any` (which ESLint rejects). The display
   * name comes from the manifest so it always matches what the plugin list shows.
   */
  private enabledCompetingPluginNames(): string[] {
    const app = this.app as App & {
      plugins?: {
        enabledPlugins?: Set<string>;
        manifests?: Record<string, { name?: string; }>;
      };
    };

    return ObsidianAutoCardLinkSettingTab.COMPETING_PLUGIN_IDS
      .filter(id => app.plugins?.enabledPlugins?.has(id))
      .map(id => app.plugins?.manifests?.[id]?.name ?? id);
  }

  /** "Paste as" and "Drop as" differ only in their text and where they store the value. */
  private addOutputShapeSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string | DocumentFragment,
    current: OutputShape,
    assign: (value: OutputShape) => void
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((drop) => drop
        .addOption("none", "Plain URL")
        .addOption("markdown-link", "Markdown link")
        .addOption("card", "Card link")
        .setValue(current)
        .onChange(async (value: string) => {
          assign(value as OutputShape);
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  /**
   * Description built as a fragment so each option can sit on its own bullet, mapping the
   * dropdown's entries to what they insert.
   *
   * Note that the sentence-case rule only inspects string literals handed to setDesc, so
   * the text below is not linted - keep it in sentence case by hand, with "Markdown"
   * capitalised as the proper noun it is.
   */
  private optionListDesc(
    intro: string,
    options: Array<[string, string]>,
    outro?: string
  ): DocumentFragment {
    const desc = activeDocument.createDocumentFragment();
    desc.appendText(intro);

    const list = desc.createEl("ul", { cls: "auto-card-link-option-list" });
    for (const [label, effect] of options) {
      const item = list.createEl("li");
      item.createEl("strong", { text: label });
      item.appendText(` — ${effect}`);
    }

    if (outro) desc.appendText(outro);
    return desc;
  }

  /**
   * One notice covering every competing plugin that is enabled, shown only while we
   * actually intercept something. The clash is over the event itself, not over what we
   * insert: whichever plugin's handler runs first wins the paste, so a card is no safer
   * than an inline link here.
   */
  private addCollisionWarning(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    if (settings?.pasteAs === "none" && settings?.dropAs === "none") return;

    const names = this.enabledCompetingPluginNames();
    if (names.length === 0) return;

    const list = names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : names[0];

    new Setting(containerEl)
      .setName(this.warningLabel(names.length > 1
        ? "Other plugins also handle these events!"
        : "Another plugin also handles these events!"))
      .setDesc(`${list} also act${names.length > 1 ? "" : "s"} on URLs you paste or drop, so whichever plugin handles the event first wins it. Either disable the other one, or turn the two options below off and use the hotkey-assignable commands instead.`)
      .setClass("auto-card-link-warning");
  }

  /** A setting name prefixed with a warning icon. */
  private warningLabel(text: string): DocumentFragment {
    const label = activeDocument.createDocumentFragment();
    setIcon(label.createSpan({ cls: "auto-card-link-warning-icon" }), "alert-triangle");
    label.appendText(text);
    return label;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addCollisionWarning(containerEl);

    this.addOutputShapeSetting(
      containerEl,
      "Paste as",
      this.optionListDesc(
        "What pasting a URL with the default paste command produces.",
        [
          ["Plain URL", "pasted unchanged, as Obsidian would"],
          ["Markdown link", "an inline link with the fetched page title and the site name"],
          ["Card link", "the full card block"],
        ],
        "The paste-and-enhance commands stay available whatever this is set to, so each option can also have its own hotkey."
      ),
      this.plugin.settings?.pasteAs ?? "none",
      (value) => { if (this.plugin.settings) this.plugin.settings.pasteAs = value; }
    );

    this.addOutputShapeSetting(
      containerEl,
      "Drop as",
      "What dropping a URL into the editor produces, for instance one dragged from a browser's address bar. Kept separate from the paste option, so a drop can still build a card while pasting stays plain.",
      this.plugin.settings?.dropAs ?? "none",
      (value) => { if (this.plugin.settings) this.plugin.settings.dropAs = value; }
    );

    containerEl.createEl("hr", { cls: "auto-card-link-settings-divider" });

    new Setting(containerEl)
      .setName("Add commands in menu item")
      .setDesc("Whether to add commands in right click menu items (refresh and delete will always be visible).")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.showInMenuItem)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.showInMenuItem = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Add blank line before card")
      .setDesc("Insert an empty line before each card link block when converting a URL.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.blankLineBeforeCard)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.blankLineBeforeCard = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Use external service for blocked sites")
      .setDesc("When a site blocks direct fetching, fetch its metadata through the external microlink.io service as a last resort. This sends the link's URL to microlink.io. Off by default for privacy; only used when the normal fetch fails.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.useExternalFallback)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.useExternalFallback = value;
            await this.plugin.saveSettings();
          });
      });

    // --- Images ---
    new Setting(containerEl).setName("Images").setHeading();

    new Setting(containerEl)
      .setName("Thumbnail quality")
      .setDesc(this.optionListDesc(
        "Which size the card thumbnail is fetched at.",
        [
          ["Best looking", "matched to the card's dimensions: sharper, and faster to load"],
          ["Max resolution", "always the highest available, which takes more disk space and can look pixelated on a small card"],
        ]
      ))
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("better-preview", "Best looking")
          .addOption("max-resolution", "Max resolution")
          .setValue(this.plugin.settings.thumbnailQuality)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailQuality = value as "better-preview" | "max-resolution";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Save images locally")
      // "URLs" is the correct plural of the acronym; the rule only knows the singular.
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Download and save card thumbnail images to your vault instead of linking to remote URLs.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.downloadImages)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.downloadImages = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Image folder")
      .setDesc("Vault folder where downloaded images are saved.")
      .addSearch((search) => {
        if (!this.plugin.settings) return;
        search
          // A folder path, not a sentence — its capitals are part of the default value.
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder("AutoCardLink/images")
          .setValue(this.plugin.settings.imageFolder)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.imageFolder = value.trim() || "AutoCardLink/images";
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, search.inputEl);
      });

    new Setting(containerEl)
      .setName("Save favicons locally")
      // "URLs" is the correct plural of the acronym; the rule only knows the singular.
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Download and save card favicons to your vault instead of linking to remote URLs.")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.downloadFavicons)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.downloadFavicons = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Favicon folder")
      .setDesc("Vault folder where downloaded favicons are saved.")
      .addSearch((search) => {
        if (!this.plugin.settings) return;
        search
          // A folder path, not a sentence — its capitals are part of the default value.
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder("AutoCardLink/favicons")
          .setValue(this.plugin.settings.faviconFolder)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.faviconFolder = value.trim() || "AutoCardLink/favicons";
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, search.inputEl);
      });

    // --- Appearance ---
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Card style")
      .setDesc("Visual style of the card link.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("classic", "Classic")
          .addOption("modern", "Modern")
          .addOption("glass", "Glass")
          .addOption("compact", "Compact")
          .setValue(this.plugin.settings.cardStyle)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.cardStyle = value as "classic" | "modern" | "glass" | "compact";
            await this.plugin.saveSettings();
            applyCardStyle(this.plugin.settings.cardStyle);
          });
      });

    new Setting(containerEl)
      .setName("Thumbnail position")
      .setDesc("Which side of the card the thumbnail appears on.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("left", "Left")
          .addOption("right", "Right")
          .setValue(this.plugin.settings.thumbnailPosition)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailPosition = value as "left" | "right";
            await this.plugin.saveSettings();
            applyThumbnailPosition(value as "left" | "right");
          });
      });

    new Setting(containerEl)
      .setName("Thumbnail fit")
      .setDesc("How the thumbnail image fills its frame: crop to fill, or shrink to show the whole image.")
      .addDropdown((drop) => {
        if (!this.plugin.settings) return drop;
        return drop
          .addOption("cover", "Crop to fill")
          .addOption("contain", "Show whole image")
          .setValue(this.plugin.settings.thumbnailFit)
          .onChange(async (value: string) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.thumbnailFit = value as "cover" | "contain";
            await this.plugin.saveSettings();
            applyThumbnailFit(this.plugin.settings.thumbnailFit);
          });
      });
  }
}

export function applyThumbnailPosition(position: "left" | "right"): void {
  activeDocument.body.classList.toggle(
    "auto-card-link-thumbnail-right",
    position === "right"
  );
}

export function applyCardStyle(style: "classic" | "modern" | "glass" | "compact"): void {
  activeDocument.body.classList.remove(
    "auto-card-link-style-modern",
    "auto-card-link-style-glass",
    "auto-card-link-style-compact"
  );
  if (style !== "classic") activeDocument.body.classList.add(`auto-card-link-style-${style}`);
}

export function applyThumbnailFit(fit: "cover" | "contain"): void {
  activeDocument.body.classList.toggle(
    "auto-card-link-thumbnail-fit-contain",
    fit === "contain"
  );
}