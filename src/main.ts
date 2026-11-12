import { MarkdownView, Notice, Platform, Plugin, addIcon } from "obsidian";
import { DialogueController } from "./controller";
import { GeminiClient } from "./gemini/client";
import { DialogueGenerator } from "./gemini/generator";
import { TtsService } from "./gemini/tts";
import { t } from "./i18n";
import { MemoryStore } from "./memory-store";
import { AadSettingTab, AadSettings, ApiKeyStore, mergeSettings } from "./settings";
import { NoteWriter } from "./writer";

const ICON = "angel-and-devil";
const ICON_VOICE = "angel-and-devil-voice";
// 100×100 icon: a halo over the left face, horns on the right face.
const ICON_SVG = [
  '<ellipse cx="30" cy="20" rx="18" ry="6" fill="none" stroke="currentColor" stroke-width="7"/>',
  '<circle cx="30" cy="56" r="20" fill="none" stroke="currentColor" stroke-width="7"/>',
  '<circle cx="72" cy="56" r="20" fill="none" stroke="currentColor" stroke-width="7"/>',
  '<path d="M57 40 L54 18 L67 34 Z M87 40 L90 18 L77 34 Z" fill="currentColor"/>',
].join("");
// Same faces with sound waves on the right: the read-aloud launcher.
const ICON_VOICE_SVG = [
  '<ellipse cx="24" cy="22" rx="14" ry="5" fill="none" stroke="currentColor" stroke-width="6"/>',
  '<circle cx="24" cy="54" r="16" fill="none" stroke="currentColor" stroke-width="6"/>',
  '<circle cx="58" cy="54" r="16" fill="none" stroke="currentColor" stroke-width="6"/>',
  '<path d="M47 41 L44 22 L55 35 Z M69 41 L72 22 L61 35 Z" fill="currentColor"/>',
  '<path d="M82 40 Q90 54 82 68 M90 32 Q102 54 90 76" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
].join("");

export default class AngelDevilPlugin extends Plugin {
  override settings!: AadSettings;
  keys!: ApiKeyStore;
  generator!: DialogueGenerator;
  tts!: TtsService;
  writer!: NoteWriter;
  memory!: MemoryStore;
  private controller!: DialogueController;

  private ribbonEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private headerActions = new WeakMap<MarkdownView, HTMLElement>();
  private voiceActions = new WeakMap<MarkdownView, HTMLElement>();
  private viewsWithAction = new Set<MarkdownView>();

  override async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.keys = new ApiKeyStore(this.app, this);
    await this.keys.migrate();
    const client = new GeminiClient(() => this.keys.get());
    this.generator = new DialogueGenerator(client);
    this.tts = new TtsService(client);
    this.writer = new NoteWriter(this.app);
    this.memory = new MemoryStore(this.app, () => this.settings.memory);
    this.controller = new DialogueController(this);

    addIcon(ICON, ICON_SVG);
    addIcon(ICON_VOICE, ICON_VOICE_SVG);
    this.addSettingTab(new AadSettingTab(this.app, this));

    this.addCommand({
      id: "start-dialogue",
      name: t.commandStart,
      icon: ICON,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.controller.start(view);
        return true;
      },
    });

    this.addCommand({
      id: "start-dialogue-voice",
      name: t.commandStartVoice,
      icon: ICON_VOICE,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.settings.tts.enabled) return false;
        if (!checking) void this.controller.start(view, "voice");
        return true;
      },
    });

    this.refreshLaunchers();
    this.app.workspace.onLayoutReady(() => this.attachHeaderActions());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.attachHeaderActions()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attachHeaderActions()));
  }

  override onunload(): void {
    this.controller?.close();
    for (const view of this.viewsWithAction) {
      this.headerActions.get(view)?.remove();
      this.voiceActions.get(view)?.remove();
    }
    this.viewsWithAction.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private startFromActive(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) void this.controller.start(view);
    else new Notice(t.noNote);
  }

  /** Header buttons on every Markdown view (F-1.1). The read-aloud launcher is only shown while TTS is on. */
  attachHeaderActions(): void {
    const voiceOn = this.settings.tts.enabled;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (!this.headerActions.has(view)) {
        const el = view.addAction(ICON, t.actionTitle, () => void this.controller.start(view));
        this.headerActions.set(view, el);
        this.viewsWithAction.add(view);
      }
      const voiceEl = this.voiceActions.get(view);
      if (voiceOn && !voiceEl) {
        this.voiceActions.set(view, view.addAction(ICON_VOICE, t.actionTitleVoice, () => void this.controller.start(view, "voice")));
        this.viewsWithAction.add(view);
      } else if (!voiceOn && voiceEl) {
        voiceEl.remove();
        this.voiceActions.delete(view);
      }
    }
    // Forget views that were closed.
    for (const view of this.viewsWithAction) {
      if (!view.containerEl.isConnected) this.viewsWithAction.delete(view);
    }
  }

  /** Ribbon (F-1.2) and status bar (F-1.4) follow the settings. */
  refreshLaunchers(): void {
    this.ribbonEl?.remove();
    this.ribbonEl = null;
    if (this.settings.showRibbon) {
      this.ribbonEl = this.addRibbonIcon(ICON, t.actionTitle, () => this.startFromActive());
    }

    this.statusEl?.remove();
    this.statusEl = null;
    if (this.settings.showStatusBar && !Platform.isMobile) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("mod-clickable", "aad-statusbar");
      this.statusEl.setText("😇😈");
      this.statusEl.setAttr("aria-label", t.actionTitle);
      this.statusEl.addEventListener("click", () => this.startFromActive());
    }
  }
}
