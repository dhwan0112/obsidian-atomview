// Test harness only: does not emulate Obsidian integration or claim app compatibility.
export class Component {
  children: Component[] = [];
  cleanups: (() => void)[] = [];
  loaded = false;
  onload() {}
  onunload() {}
  load() {
    if (!this.loaded) {
      this.loaded = true;
      this.onload();
    }
  }
  unload() {
    if (this.loaded) {
      this.loaded = false;
      this.onunload();
      for (const c of this.children) c.unload();
      for (const fn of this.cleanups) fn();
      this.cleanups = [];
    }
  }
  addChild<T extends Component>(c: T): T {
    this.children.push(c);
    if (this.loaded) c.load();
    return c;
  }
  removeChild(c: Component) {
    c.unload();
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  registerDomEvent(
    target: EventTarget,
    event: string,
    callback: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(event, callback, options);
    this.cleanups.push(() =>
      target.removeEventListener(event, callback, options),
    );
  }
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}
export class Plugin extends Component {}
export class FileView extends Component {}
export class FileSystemAdapter {
  getBasePath() {
    return "/synthetic";
  }
}
export class TFile {}
export class Notice {
  constructor(message: string) {
    console.info(message);
  }
}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}

// Obsidian DOM helper, scoped to the element's owner document.
HTMLElement.prototype.createEl = function <
  K extends keyof HTMLElementTagNameMap,
>(this: HTMLElement, tag: K) {
  const child = this.ownerDocument.createElement(tag);
  this.append(child);
  return child;
};
