import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { charName, resolveLineup } from "./characters";
import { GeminiClient } from "./gemini/client";
import { toGeminiError } from "./gemini/errors";
import { LANGUAGES } from "./lang";
import { DEFAULT_MEMORY_FOLDER, normalizeMemoryFolder } from "./memory";
import type AngelDevilPlugin from "./main";
import { t, uiLang } from "./platform/obsidian/environment";
import { type AadSettings, DEFAULT_SETTINGS, VOICES, apiKeyHint, hasApiKey } from "./settings-model";
import type { RevealSpeed } from "./types";

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
    const saved = hasApiKey(keys.get());
    // The row keeps only the name so the input and buttons have room;
    // status and the short explanation go in a note right below it.
    const keySetting = new Setting(containerEl).setName(t.setApiKey);
    const keyNote = containerEl.createDiv({ cls: "aad-key-note setting-item-description" });
    keyNote.createDiv({
      cls: "aad-key-status",
      text: saved ? t.setApiKeySaved(apiKeyHint(keys.get())) : t.setApiKeyNotSaved,
    });
    const keyInfo = keyNote.createDiv();
    keyInfo.createEl("a", { text: t.setGetKey, href: "https://aistudio.google.com/apikey" });
    keyInfo.appendText(` · ${t.setApiKeyDesc} · `);
    keyInfo.appendText(keys.secure ? t.setApiKeyStoredSecret : t.setApiKeyStoredPlain);
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
              await new GeminiClient(this.plugin.http, () => keys.get()).listModels();
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

    new Setting(containerEl).setName(t.setLanguage).setDesc(t.setLanguageDesc).addDropdown((d) => {
      d.addOption("auto", t.setLanguageAuto);
      for (const l of LANGUAGES) d.addOption(l.code, l.native);
      d.setValue(s.language).onChange(async (value) => {
        s.language = value as AadSettings["language"];
        await this.plugin.saveSettings();
      });
    });

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
      .setName(t.setReply)
      .setDesc(t.setReplyDesc)
      .addToggle((tg) =>
        tg.setValue(s.reply.enabled).onChange(async (value) => {
          s.reply.enabled = value;
          await this.plugin.saveSettings();
        }),
      );

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

    // Voice and style for the two characters in the current lineup (names in Obsidian's UI language).
    for (const spec of resolveLineup(this.plugin.settings.lineup)) {
      const who = spec.id;
      const name = charName(spec, uiLang);
      const currentVoice = tts.voices[who] ?? spec.defaultVoice;
      const currentStyle = tts.styles[who] ?? spec.defaultStyle;
      new Setting(containerEl).setName(t.setTtsVoice(name)).addDropdown((d) => {
        for (const v of VOICES) d.addOption(v, v);
        if (!VOICES.includes(currentVoice as (typeof VOICES)[number])) d.addOption(currentVoice, currentVoice);
        d.setValue(currentVoice).onChange(async (value) => {
          tts.voices[who] = value;
          await save();
        });
      });
      new Setting(containerEl)
        .setName(t.setTtsStyle(name))
        .setDesc(t.setTtsStyleDesc)
        .addText((text) =>
          text.setValue(currentStyle).onChange(async (value) => {
            tts.styles[who] = value.trim() || spec.defaultStyle;
            await save();
          }),
        );
    }
  }
}
