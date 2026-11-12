import { MarkdownView, Notice, TFile } from "obsidian";
import { AudioPlayer } from "./audio/player";
import { TurnTimeline } from "./audio/timeline";
import { resolveLineup } from "./characters";
import { toMarkdown } from "./format";
import { toGeminiError } from "./gemini/errors";
import { MAX_TURNS, MIN_TURNS } from "./gemini/schema";
import { t } from "./i18n";
import { prepareInput } from "./input";
import type AngelDevilPlugin from "./main";
import type { LoadedMemory } from "./memory-store";
import type { CharacterSpec, Dialogue } from "./types";
import { confirmTts } from "./ui/confirm";
import { DialogueModal } from "./ui/modal";

/**
 * - "text": show the banter first; reading aloud is an optional extra.
 * - "voice": read-aloud launch — wait on a loading screen until the voice is ready, then reveal the
 *   bubbles in step with the audio.
 */
export type LaunchMode = "text" | "voice";

interface DialogueSession {
  /** Bumped on every generation; late results with an old id are discarded (design doc §5.2). */
  id: number;
  mode: LaunchMode;
  sourceFile: TFile;
  input: string;
  truncated: boolean;
  lineup: readonly [CharacterSpec, CharacterSpec];
  /** Memory folder for this banter, or null when memory is off (or the note is inside that folder). */
  memoryFolder: string | null;
  dialogue?: Dialogue;
  saved: boolean;
  /** WAV for the current dialogue (F-6.7). Cleared on regenerate. */
  audio?: { key: string; wav: Uint8Array };
}

/** Plugin-wide cache of the latest clips, keyed by dialogue + voice settings (design doc §5.9). */
const AUDIO_CACHE_SIZE = 5;

/**
 * DialogueController (design doc §2.2): runs one banter from start to close.
 * Owns the session; tells the modal what to show; asks the generator / TTS / writer to do the work.
 */
export class DialogueController {
  private session: DialogueSession | null = null;
  private modal: DialogueModal | null = null;
  private nextId = 1;
  private player: AudioPlayer | null = null;
  private speakToken = 0;
  private readonly audioCache = new Map<string, Uint8Array>();
  private memoryWrites: Promise<void> = Promise.resolve();

  constructor(private readonly plugin: AngelDevilPlugin) {}

  async start(view: MarkdownView, mode: LaunchMode = "text"): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice(t.noNote);
      return;
    }
    const selection = view.editor.getSelection();
    const prepared = prepareInput(selection || view.editor.getValue(), {
      fromSelection: selection.length > 0,
      maxChars: this.plugin.settings.maxInputChars,
    });
    if (!prepared.ok) {
      new Notice(t.tooShort);
      return;
    }
    if (!this.plugin.keys.get().trim()) {
      new Notice(t.noKey);
      this.openSettings();
      return;
    }
    if (mode === "voice" && !this.plugin.settings.tts.enabled) {
      new Notice(t.ttsOff);
      return;
    }

    this.close();
    if (mode === "voice" && !(await this.approveVoice(`${MIN_TURNS}–${MAX_TURNS}`))) return;

    const lineup = resolveLineup(this.plugin.settings.lineup);
    this.session = {
      id: 0,
      mode,
      sourceFile: file,
      input: prepared.text,
      truncated: prepared.truncated,
      lineup,
      memoryFolder: this.plugin.memory.folderFor(file),
      saved: false,
    };
    this.modal = new DialogueModal(
      this.plugin.app,
      {
        onSave: () => void this.save(),
        onRetry: () => void this.generate(),
        onRegenerate: () => void this.generate(),
        onOpenSettings: () => this.openSettings(),
        onSpeak: () => void this.speak(),
        onStopAudio: () => this.stopAudio(),
        onClose: () => this.discard(),
      },
      {
        animation: this.plugin.settings.animation,
        revealSpeed: this.plugin.settings.revealSpeed,
        tts: this.plugin.settings.tts.enabled,
        lineup,
      },
    );
    this.modal.open();
    await this.generate({ voiceApproved: mode === "voice" });
  }

  /**
   * ② / ③ / ⑥: (re)generates for the current session. In voice mode the voice is prepared too
   * before anything is shown. `voiceApproved` skips the confirm when the launch already asked.
   */
  async generate(options: { voiceApproved?: boolean } = {}): Promise<void> {
    const session = this.session;
    const modal = this.modal;
    if (!session || !modal) return;

    let voice = session.mode === "voice";
    // Again / Retry in voice mode are new TTS calls: ask again (inside this click), or fall back to text.
    if (voice && !options.voiceApproved) voice = await this.approveVoice(`${MIN_TURNS}–${MAX_TURNS}`);
    if (this.session !== session) return;

    const id = (session.id = this.nextId++);
    this.stopAudio();
    session.dialogue = undefined;
    session.saved = false;
    session.audio = undefined;
    modal.showLoading({ voice });

    const s = this.plugin.settings;
    let memory: LoadedMemory | undefined;
    if (session.memoryFolder) {
      try {
        memory = await this.plugin.memory.load(session.memoryFolder, session.sourceFile, session.lineup);
      } catch (e) {
        // Unreadable memory should not block the banter: go on without earlier memos.
        console.warn("[angel-and-devil] could not read memory", e);
        memory = { memos: {}, count: 0 };
      }
      if (this.session?.id !== id) return;
    }
    let dialogue: Dialogue;
    try {
      dialogue = await this.plugin.generator.generate({
        text: session.input,
        language: s.language,
        rounds: s.rounds,
        model: s.textModel,
        lineup: session.lineup,
        memory: memory && { memos: memory.memos },
      });
    } catch (e) {
      if (this.session?.id !== id) return;
      modal.showError(toGeminiError(e));
      return;
    }
    if (this.session?.id !== id) return;
    session.dialogue = dialogue;
    this.recordMemory(session, dialogue);
    const shown = { truncated: session.truncated, memoryCount: memory?.count ?? 0 };

    if (!voice) {
      modal.showDialogue(dialogue, { ...shown, reveal: "timer" });
      if (s.tts.enabled && s.tts.autoplay) void this.speak();
      return;
    }

    // Voice mode: stay on the loading screen until the audio is ready.
    modal.setLoadingStep("voice");
    const token = ++this.speakToken;
    const wav = await this.fetchAudio(session, dialogue);
    if (this.session?.id !== id || this.speakToken !== token) return;
    if (!wav) {
      // TTS failed (a notice was shown): fall back to the text banter.
      modal.showDialogue(dialogue, { ...shown, reveal: "timer" });
      return;
    }
    modal.showDialogue(dialogue, { ...shown, reveal: "audio" });
    await this.play(session, dialogue, wav, token);
  }

  /** ④: appends the banter to the note it was generated from. */
  async save(): Promise<void> {
    const session = this.session;
    if (!session?.dialogue || session.saved) return;
    const block = toMarkdown(session.dialogue, this.plugin.settings.headingTemplate, new Date(), session.lineup);
    const result = await this.plugin.writer.append(session.sourceFile, block);
    if (result === "not_found") {
      new Notice(t.sourceMissing);
      return;
    }
    session.saved = true;
    this.modal?.setSaved();
    new Notice(t.savedNotice);
  }

  /** ⑤: reads the current banter aloud (the 🔊 button), from the cache when possible. */
  async speak(): Promise<void> {
    const session = this.session;
    const dialogue = session?.dialogue;
    if (!session || !this.modal || !dialogue) return;
    const token = ++this.speakToken;
    const player = this.ensurePlayer();
    player.stop();
    // Unlock before the first await so it still counts as part of the click (iOS). With confirmation on,
    // the confirm dialog's OK click unlocks instead.
    if (!this.plugin.settings.tts.confirmEveryTime) player.unlock();

    const key = await audioKey(dialogue, this.plugin.settings.tts);
    const cached = session.audio?.key === key ? session.audio.wav : this.audioCache.get(key);
    if (!cached && !(await this.approveVoice(String(dialogue.turns.length)))) return;
    if (this.session !== session || this.speakToken !== token) return;

    if (!cached) this.modal.setAudioState("loading");
    const wav = cached ?? (await this.fetchAudio(session, dialogue));
    if (this.session !== session || this.speakToken !== token) return;
    if (!wav) {
      this.modal.setAudioState("idle");
      return;
    }
    await this.play(session, dialogue, wav, token);
  }

  stopAudio(): void {
    this.speakToken++;
    this.player?.stop();
    this.modal?.setAudioState(this.session?.audio ? "ended" : "idle");
  }

  /** ⑥: closes the modal (if open) and forgets the session. */
  close(): void {
    const modal = this.modal;
    this.discard();
    modal?.dismiss();
  }

  // --- internals ---

  private ensurePlayer(): AudioPlayer {
    return (this.player ??= new AudioPlayer());
  }

  /**
   * Billing confirmation (F-6.2) and the iOS audio unlock. Call it before any other await in a click
   * handler where possible, so the unlock still counts as part of the user gesture.
   */
  private async approveVoice(turns: string): Promise<boolean> {
    const tts = this.plugin.settings.tts;
    const player = this.ensurePlayer();
    if (!tts.confirmEveryTime) {
      player.unlock();
      return true;
    }
    const { approved, dontAskAgain } = await confirmTts(this.plugin.app, { model: tts.model, turns }, () =>
      player.unlock(),
    );
    if (approved && dontAskAgain) {
      // Same effect as turning off "Confirm every time" in the settings tab, where it can be turned back on.
      tts.confirmEveryTime = false;
      await this.plugin.saveSettings();
    }
    return approved;
  }

  /** Returns WAV for the dialogue (cache first), or null after showing a notice. */
  private async fetchAudio(session: DialogueSession, dialogue: Dialogue): Promise<Uint8Array | null> {
    const tts = this.plugin.settings.tts;
    const key = await audioKey(dialogue, tts);
    let wav = session.audio?.key === key ? session.audio.wav : this.audioCache.get(key);
    if (!wav) {
      try {
        wav = await this.plugin.tts.synthesize(dialogue.turns, tts, session.lineup);
      } catch (e) {
        new Notice(t[`err_${toGeminiError(e).kind}`]);
        return null;
      }
      this.remember(key, wav);
    }
    session.audio = { key, wav };
    return wav;
  }

  private async play(session: DialogueSession, dialogue: Dialogue, wav: Uint8Array, token: number): Promise<void> {
    const modal = this.modal;
    if (!modal) return;
    const current = () => this.session === session && session.dialogue === dialogue && this.speakToken === token;
    const timeline = new TurnTimeline(dialogue.turns);
    const speedMap = this.plugin.settings.tts.speed;
    const speed = speedMap[dialogue.language] ?? speedMap.en ?? 1.0;
    try {
      await this.ensurePlayer().play(wav, speed, {
        onFrame: (level, currentTime, duration) => {
          if (current()) modal.setActiveTurn(timeline.indexAt(currentTime, duration), level);
        },
        onEnded: () => {
          if (current()) modal.setAudioState("ended");
        },
      });
      if (current()) modal.setAudioState("playing");
    } catch {
      // Playback refused (e.g. no user gesture on iOS): show the text instead.
      if (current()) modal.setAudioState("idle");
    }
  }

  /**
   * Records the banter in memory as soon as it is shown (no save needed). Writes run one after another,
   * so a quick "Again" replaces the earlier record instead of racing it.
   */
  private recordMemory(session: DialogueSession, dialogue: Dialogue): void {
    const folder = session.memoryFolder;
    const memory = dialogue.memory;
    if (!folder || !memory) return;
    const now = new Date();
    this.memoryWrites = this.memoryWrites
      .then(() => this.plugin.memory.record(folder, session.sourceFile, session.lineup, memory, now))
      .catch((e) => {
        console.warn("[angel-and-devil] could not write memory", e);
        new Notice(t.memoryWriteFailed);
      });
  }

  private remember(key: string, wav: Uint8Array): void {
    this.audioCache.delete(key);
    this.audioCache.set(key, wav);
    while (this.audioCache.size > AUDIO_CACHE_SIZE) {
      const oldest = this.audioCache.keys().next().value;
      if (oldest === undefined) break;
      this.audioCache.delete(oldest);
    }
  }

  private discard(): void {
    this.speakToken++;
    this.player?.dispose();
    this.player = null;
    this.session = null;
    this.modal = null;
  }

  private openSettings(): void {
    const setting = (this.plugin.app as unknown as {
      setting?: { open(): void; openTabById(id: string): void };
    }).setting;
    if (!setting) return;
    this.close();
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }
}

/** SHA-256 of everything that changes the audio (design doc §5.9). */
async function audioKey(dialogue: Dialogue, tts: { model: string; voices: object; styles: object }): Promise<string> {
  const text = JSON.stringify([tts.model, tts.voices, tts.styles, dialogue.turns]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
