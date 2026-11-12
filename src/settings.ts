import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { ANGEL_SPEC, DEVIL_SPEC } from "./characters";
import { DEFAULT_HEADING_TEMPLATE } from "./format";
import { GeminiClient } from "./gemini/client";
import { toGeminiError } from "./gemini/errors";
import { t } from "./i18n";
import { DEFAULT_MEMORY_FOLDER, normalizeMemoryFolder } from "./memory";
import type { Lang, RevealSpeed, Rounds, SpeakerId, VendorId } from "./types";
import type AngelDevilPlugin from "./main";

export const CURRENT_SCHEMA_VERSION = 1;

export interface AadSettings {
  /** Monotonically increasing integer; bumped only on breaking schema changes (ADR-0003). */
  schemaVersion: number;
  /** Only used when SecretStorage is unavailable (Obsidian < 1.11.4). */
  apiKey: string;
  textVendor: VendorId;
  textModel: string;
  language: "auto" | Lang;
  rounds: Rounds;
  /** Two-slot character lineup `[leadId, counterId]`. Defaults to `["angel", "devil"]`. */
  lineup: [SpeakerId, SpeakerId];
  animation: boolean;
  revealSpeed: RevealSpeed;
  headingTemplate: string;
  showRibbon: boolean;
  showStatusBar: boolean;
  maxInputChars: number;
  tts: TtsSettings;
  memory: MemorySettings;
}

/** Memory across banters (ADR-0004). Off by default; the files live in a visible vault folder. */
export interface MemorySettings {
  enabled: boolean;
  /** Vault-relative folder. Never a dot folder (see normalizeMemoryFolder). */
  folder: string;
}

export interface TtsSettings {
  enabled: boolean;
  vendor: VendorId;
  model: string;
  confirmEveryTime: boolean;
  autoplay: boolean;
  speed: Record<Lang, number>;
  voices: Record<SpeakerId, string>;
  styles: Record<SpeakerId, string>;
}

/** Prebuilt Gemini TTS voices (dot-agent skill: references/Voices.md). */
export const VOICES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Pulcherrima",
  "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr",
  "Zubenelgenubi",
] as const;

export const DEFAULT_SETTINGS: AadSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  apiKey: "",
  textVendor: "gemini",
  // Alias that follows Google's current Flash model (PRD §12.2: the default is still to be decided).
  textModel: "gemini-flash-latest",
  language: "auto",
  rounds: "auto",
  lineup: [ANGEL_SPEC.id, DEVIL_SPEC.id],
  animation: true,
  revealSpeed: "normal",
  headingTemplate: DEFAULT_HEADING_TEMPLATE,
  showRibbon: true,
  showStatusBar: false,
  maxInputChars: 20_000,
  // Defaults mirror the CLI skill's settings.yaml.
  tts: {
    enabled: false,
    vendor: "gemini",
    model: "gemini-3.8-flash-tts",
    confirmEveryTime: true,
    autoplay: false,
    speed: { ja: 1.2, en: 1.1 },
    voices: { [ANGEL_SPEC.id]: ANGEL_SPEC.defaultVoice, [DEVIL_SPEC.id]: DEVIL_SPEC.defaultVoice },
    styles: {
      [ANGEL_SPEC.id]: ANGEL_SPEC.defaultStyle,
      [DEVIL_SPEC.id]: DEVIL_SPEC.defaultStyle,
    },
  },
  memory: {
    enabled: false,
    folder: DEFAULT_MEMORY_FOLDER,
  },
};

function isValidLineup(value: unknown): value is [SpeakerId, SpeakerId] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    value[0].trim().length > 0 &&
    value[1].trim().length > 0 &&
    value[0] !== value[1]
  );
}

/** Deep-merges saved data over the defaults so new fields appear after an update (design doc §4.1, ADR-0003). */
export function mergeSettings(saved: unknown): AadSettings {
  const s = saved && typeof saved === "object" ? (saved as Partial<AadSettings>) : {};
  const d = DEFAULT_SETTINGS.tts;
  const tts = (s.tts ?? {}) as Partial<TtsSettings>;
  const schemaVersion =
    typeof s.schemaVersion === "number" && Number.isInteger(s.schemaVersion) && s.schemaVersion >= 1
      ? s.schemaVersion
      : CURRENT_SCHEMA_VERSION;
  const textVendor =
    typeof s.textVendor === "string" && s.textVendor.trim().length > 0
      ? s.textVendor.trim()
      : DEFAULT_SETTINGS.textVendor;
  const lineup: [SpeakerId, SpeakerId] = isValidLineup(s.lineup)
    ? [s.lineup[0], s.lineup[1]]
    : [...DEFAULT_SETTINGS.lineup];
  const ttsVendor =
    typeof tts.vendor === "string" && tts.vendor.trim().length > 0 ? tts.vendor.trim() : d.vendor;
  const memory = (s.memory ?? {}) as Partial<MemorySettings>;
  const memoryFolder =
    (typeof memory.folder === "string" && normalizeMemoryFolder(memory.folder)) || DEFAULT_SETTINGS.memory.folder;

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    schemaVersion,
    textVendor,
    lineup,
    tts: {
      ...d,
      ...tts,
      vendor: ttsVendor,
      speed: { ...d.speed, ...(tts.speed ?? {}) },
      voices: { ...d.voices, ...(tts.voices ?? {}) },
      styles: { ...d.styles, ...(tts.styles ?? {}) },
    },
    memory: {
      enabled: memory.enabled === true,
      folder: memoryFolder,
    },
  };
}

const SECRET_ID = "angel-and-devil-gemini-api-key";

interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

/** API key storage (design doc §5.3): SecretStorage when the app has it, data.json otherwise. */
export class ApiKeyStore {
  constructor(
    private readonly app: App,
    private readonly plugin: AngelDevilPlugin,
  ) {}

  private get secrets(): SecretStorageLike | undefined {
    const s = (this.app as App & { secretStorage?: SecretStorageLike }).secretStorage;
    return s && typeof s.getSecret === "function" ? s : undefined;
  }

  get usesSecretStorage(): boolean {
    return this.secrets !== undefined;
  }

  /**
   * Moves a plaintext key left in data.json (saved on an Obsidian without SecretStorage) into
   * SecretStorage and clears it from data.json. Runs on every load; a no-op once migrated.
   */
  async migrate(): Promise<void> {
    const secrets = this.secrets;
    const plain = this.plugin.settings.apiKey;
    if (!secrets || !plain) return;
    // A key already in SecretStorage wins: it was entered later than the plaintext one.
    if (!secrets.getSecret(SECRET_ID)) secrets.setSecret(SECRET_ID, plain);
    this.plugin.settings.apiKey = "";
    await this.plugin.saveSettings();
  }

  get(): string {
    const secrets = this.secrets;
    if (secrets) return secrets.getSecret(SECRET_ID) ?? "";
    return this.plugin.settings.apiKey;
  }

  has(): boolean {
    return this.get().trim().length > 0;
  }

  /** Last four characters, for "saved (••••abcd)" — never the whole key. */
  hint(): string {
    const key = this.get().trim();
    return key.length > 8 ? key.slice(-4) : "";
  }

  async set(value: string): Promise<void> {
    const secrets = this.secrets;
    if (secrets) {
      secrets.setSecret(SECRET_ID, value);
      // Never keep a plaintext copy once the secret store is available.
      if (this.plugin.settings.apiKey) {
        this.plugin.settings.apiKey = "";
        await this.plugin.saveSettings();
      }
      return;
    }
    this.plugin.settings.apiKey = value;
    await this.plugin.saveSettings();
  }

  /** SecretStorage has no delete; an empty value means "not set". */
  async clear(): Promise<void> {
    await this.set("");
  }
}

export class AadSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AngelDevilPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    // The saved key is never put back into the input (it would be readable from the DOM).
    // The field is only for entering a new key; "Save" stores it and clears the field.
    const keys = this.plugin.keys;
    const saved = keys.has();
    // The row keeps only the name so the input and buttons have room;
    // status and the short explanation go in a note right below it.
    const keySetting = new Setting(containerEl).setName(t.setApiKey);
    const keyNote = containerEl.createDiv({ cls: "aad-key-note setting-item-description" });
    keyNote.createDiv({
      cls: "aad-key-status",
      text: saved ? t.setApiKeySaved(keys.hint()) : t.setApiKeyNotSaved,
    });
    const keyInfo = keyNote.createDiv();
    keyInfo.createEl("a", { text: t.setGetKey, href: "https://aistudio.google.com/apikey" });
    keyInfo.appendText(` · ${t.setApiKeyDesc} · `);
    keyInfo.appendText(keys.usesSecretStorage ? t.setApiKeyStoredSecret : t.setApiKeyStoredPlain);
    let input: HTMLInputElement | null = null;
    const saveKey = async () => {
      const value = input?.value.trim() ?? "";
      if (!value) {
        new Notice(t.setApiKeyEmpty);
        return;
      }
      await keys.set(value);
      if (input) input.value = "";
      new Notice(t.setApiKeySavedNotice);
      this.display();
    };
    keySetting
      .addText((text) => {
        input = text.inputEl;
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.setPlaceholder(saved ? t.setApiKeyPlaceholderReplace : "AIza…");
        text.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            void saveKey();
          }
        });
      })
      .addButton((button) => button.setButtonText(t.setApiKeySave).setCta().onClick(() => void saveKey()));
    if (saved) {
      keySetting
        .addButton((button) =>
          button.setButtonText(t.setCheckKey).onClick(async () => {
            button.setDisabled(true);
            try {
              await new GeminiClient(() => keys.get()).listModels();
              new Notice(t.setCheckOk);
            } catch (e) {
              new Notice(t[`err_${toGeminiError(e).kind}`]);
            } finally {
              button.setDisabled(false);
            }
          }),
        )
        .addButton((button) =>
          button
            .setButtonText(t.setApiKeyDelete)
            .setWarning()
            .onClick(async () => {
              await keys.clear();
              new Notice(t.setApiKeyDeletedNotice);
              this.display();
            }),
        );
    }

    new Setting(containerEl)
      .setName(t.setModel)
      .setDesc(t.setModelDesc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.textModel)
          .setValue(s.textModel)
          .onChange(async (value) => {
            s.textModel = value.trim() || DEFAULT_SETTINGS.textModel;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName(t.setLanguage).addDropdown((d) =>
      d
        .addOption("auto", t.setLanguageAuto)
        .addOption("ja", "日本語")
        .addOption("en", "English")
        .setValue(s.language)
        .onChange(async (value) => {
          s.language = value as AadSettings["language"];
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName(t.setRounds).addDropdown((d) =>
      d
        .addOption("auto", t.setRoundsAuto)
        .addOption("2", t.setRounds2)
        .addOption("3", t.setRounds3)
        .setValue(String(s.rounds))
        .onChange(async (value) => {
          s.rounds = value === "auto" ? "auto" : (Number(value) as 2 | 3);
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl)
      .setName(t.setAnimation)
      .setDesc(t.setAnimationDesc)
      .addToggle((tg) =>
        tg.setValue(s.animation).onChange(async (value) => {
          s.animation = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t.setSpeed).addDropdown((d) =>
      d
        .addOption("slow", t.setSpeedSlow)
        .addOption("normal", t.setSpeedNormal)
        .addOption("fast", t.setSpeedFast)
        .setValue(s.revealSpeed)
        .onChange(async (value) => {
          s.revealSpeed = value as RevealSpeed;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl)
      .setName(t.setHeading)
      .setDesc(t.setHeadingDesc)
      .addText((text) =>
        text.setValue(s.headingTemplate).onChange(async (value) => {
          s.headingTemplate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t.setRibbon).addToggle((tg) =>
      tg.setValue(s.showRibbon).onChange(async (value) => {
        s.showRibbon = value;
        await this.plugin.saveSettings();
        this.plugin.refreshLaunchers();
      }),
    );

    if (!Platform.isMobile) {
      new Setting(containerEl).setName(t.setStatusBar).addToggle((tg) =>
        tg.setValue(s.showStatusBar).onChange(async (value) => {
          s.showStatusBar = value;
          await this.plugin.saveSettings();
          this.plugin.refreshLaunchers();
        }),
      );
    }

    new Setting(containerEl)
      .setName(t.setMaxChars)
      .setDesc(t.setMaxCharsDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.maxInputChars)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 500) {
            s.maxInputChars = Math.floor(n);
            await this.plugin.saveSettings();
          }
        });
      });

    this.displayMemory(containerEl);
    this.displayTts(containerEl);
  }

  private displayMemory(containerEl: HTMLElement): void {
    const memory = this.plugin.settings.memory;
    new Setting(containerEl).setName(t.setMemoryHeading).setHeading();

    new Setting(containerEl)
      .setName(t.setMemoryEnabled)
      .setDesc(t.setMemoryEnabledDesc)
      .addToggle((tg) =>
        tg.setValue(memory.enabled).onChange(async (value) => {
          memory.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    if (!memory.enabled) return;

    new Setting(containerEl)
      .setName(t.setMemoryFolder)
      .setDesc(t.setMemoryFolderDesc)
      .addText((text) => {
        text.setPlaceholder(DEFAULT_MEMORY_FOLDER).setValue(memory.folder);
        // Saved when the field loses focus, so half-typed paths are never used.
        text.inputEl.addEventListener("blur", async () => {
          const raw = text.getValue();
          const folder = raw.trim() ? normalizeMemoryFolder(raw) : DEFAULT_MEMORY_FOLDER;
          if (!folder) {
            new Notice(t.setMemoryFolderInvalid);
            text.setValue(memory.folder);
            return;
          }
          text.setValue(folder);
          if (folder === memory.folder) return;
          memory.folder = folder;
          await this.plugin.saveSettings();
        });
      });
  }

  private displayTts(containerEl: HTMLElement): void {
    const tts = this.plugin.settings.tts;
    const save = () => this.plugin.saveSettings();
    new Setting(containerEl).setName(t.setTtsHeading).setHeading();

    new Setting(containerEl)
      .setName(t.setTtsEnabled)
      .setDesc(t.setTtsEnabledDesc)
      .addToggle((tg) =>
        tg.setValue(tts.enabled).onChange(async (value) => {
          tts.enabled = value;
          await save();
          this.plugin.attachHeaderActions();
          this.display();
        }),
      );
    if (!tts.enabled) return;

    new Setting(containerEl).setName(t.setTtsModel).addText((text) =>
      text
        .setPlaceholder(DEFAULT_SETTINGS.tts.model)
        .setValue(tts.model)
        .onChange(async (value) => {
          tts.model = value.trim() || DEFAULT_SETTINGS.tts.model;
          await save();
        }),
    );

    new Setting(containerEl)
      .setName(t.setTtsConfirm)
      .setDesc(t.setTtsConfirmDesc)
      .addToggle((tg) =>
        tg.setValue(tts.confirmEveryTime).onChange(async (value) => {
          tts.confirmEveryTime = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t.setTtsAutoplay)
      .setDesc(t.setTtsAutoplayDesc)
      .addToggle((tg) =>
        tg.setValue(tts.autoplay).onChange(async (value) => {
          tts.autoplay = value;
          await save();
        }),
      );

    for (const [lang, name] of [
      ["ja", t.setTtsSpeedJa],
      ["en", t.setTtsSpeedEn],
    ] as const) {
      new Setting(containerEl).setName(name).addSlider((sl) =>
        sl
          .setLimits(0.8, 2.0, 0.05)
          .setValue(tts.speed[lang] ?? DEFAULT_SETTINGS.tts.speed[lang])
          .setDynamicTooltip()
          .onChange(async (value) => {
            tts.speed[lang] = value;
            await save();
          }),
      );
    }

    for (const [who, voiceName, styleName] of [
      ["angel", t.setTtsVoiceAngel, t.setTtsStyleAngel],
      ["devil", t.setTtsVoiceDevil, t.setTtsStyleDevil],
    ] as const) {
      const currentVoice = tts.voices[who] ?? DEFAULT_SETTINGS.tts.voices[who];
      const currentStyle = tts.styles[who] ?? DEFAULT_SETTINGS.tts.styles[who];
      new Setting(containerEl).setName(voiceName).addDropdown((d) => {
        for (const v of VOICES) d.addOption(v, v);
        if (!VOICES.includes(currentVoice as (typeof VOICES)[number])) d.addOption(currentVoice, currentVoice);
        d.setValue(currentVoice).onChange(async (value) => {
          tts.voices[who] = value;
          await save();
        });
      });
      new Setting(containerEl)
        .setName(styleName)
        .setDesc(t.setTtsStyleDesc)
        .addText((text) =>
          text.setValue(currentStyle).onChange(async (value) => {
            tts.styles[who] = value.trim() || DEFAULT_SETTINGS.tts.styles[who];
            await save();
          }),
        );
    }
  }
}
