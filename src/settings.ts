import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianAutoCardLink from "src/main";

export interface ObsidianAutoCardLinkSettings {
  showInMenuItem: boolean;
  enhanceDefaultPaste: boolean;
  thumbnailPosition: "left" | "right";  // ← add
}

export const DEFAULT_SETTINGS: ObsidianAutoCardLinkSettings = {
  showInMenuItem: true,
  enhanceDefaultPaste: false,
  thumbnailPosition: "left",
};

export class ObsidianAutoCardLinkSettingTab extends PluginSettingTab {
  plugin: ObsidianAutoCardLink;

  constructor(app: App, plugin: ObsidianAutoCardLink) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- General ---
    containerEl.createEl("h3", { text: "General" });

    new Setting(containerEl)
      .setName("Enhance Default Paste")
      .setDesc("Fetch the link metadata when pasting a url in the editor with the default paste command")
      .addToggle((val) => {
        if (!this.plugin.settings) return;
        return val
          .setValue(this.plugin.settings.enhanceDefaultPaste)
          .onChange(async (value) => {
            if (!this.plugin.settings) return;
            this.plugin.settings.enhanceDefaultPaste = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Add commands in menu item")
      .setDesc("Whether to add commands in right click menu items")
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

    // --- Appearance ---
    containerEl.createEl("h3", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Thumbnail position")
      .setDesc("Which side of the card the thumbnail appears on")
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
  }
}

export function applyThumbnailPosition(position: "left" | "right"): void {
  document.body.classList.toggle(
    "auto-card-link-thumbnail-right",
    position === "right"
  );
}