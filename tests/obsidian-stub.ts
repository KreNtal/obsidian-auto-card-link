// Stands in for the `obsidian` module when tests/rules.test.ts is bundled for Node: the rules
// under test never touch it, but the modules they live in import it.
class Stub {}
export class Plugin extends Stub {}
export class PluginSettingTab extends Stub {}
export class AbstractInputSuggest extends Stub {}
export class Setting extends Stub {}
export class Notice extends Stub {}
export class ButtonComponent extends Stub {}
export class MarkdownView extends Stub {}
export class Menu extends Stub {}
export class MenuItem extends Stub {}
export class TFolder extends Stub {}
export class App extends Stub {}
export class Editor extends Stub {}
export const Platform = { isDesktopApp: false, isMobile: true };
export const requestUrl = (): never => { throw new Error("no network in tests"); };
export const setIcon = (): void => undefined;
export const getLinkpath = (s: string): string => s;
export const normalizePath = (s: string): string => s;
export const parseYaml = (): never => { throw new Error("not in tests"); };
