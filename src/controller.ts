import { MarkdownView, Notice, TFile } from "obsidian";
import { AudioPlayer } from "./audio/player";
import { TurnTimeline } from "./audio/timeline";
import { concatPcmToWav, extractPcm } from "./audio/wav";
import { resolveLineup } from "./characters";
import { spokenTurns, toMarkdown } from "./format";
import { toGeminiError } from "./gemini/errors";
import type { GenerateInput, ReplyResult } from "./gemini/generator";
import { MAX_TURNS, MIN_TURNS, REPLY_TURNS } from "./gemini/schema";
import { TTS_CHUNK_GAP_MS } from "./gemini/tts";
import { runtimeLanguage, stringsFor } from "./i18n";
import { normalizeReply, prepareInput } from "./input";
import type AngelDevilPlugin from "./main";
import type { LoadedMemory, MemoryUse } from "./memory-store";
import type { Strings } from "./i18n";
import type { CharacterSpec, Dialogue, Lang } from "./types";
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
  /** Memory folder and note kind for this banter, or null when memory is off (or the note is inside that folder). */
  memory: MemoryUse | null;
  dialogue?: Dialogue;
  /**
   * The input the current banter was generated from, memory snapshot included. The reply reuses it as is:
   * reading memory again would pick up today's record written by this very banter, and an identical prompt
   * prefix can hit Gemini's implicit cache (feature: reply, dd §3).
   */
  lastInput?: GenerateInput;
  /** A reply is being generated (R-2: no second one meanwhile). */
  replying: boolean;
  saved: boolean;
  /** The block written by save(), and when: replaced by the version with the reply (R-9). */
  savedBlock?: string;
  savedAt?: Date;
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

  /** Language of everything a launch shows (the plugin's language setting; see runtimeLanguage). */
  private get lang(): Lang {
    return runtimeLanguage(this.plugin.settings.language);
  }

  private get rt(): Strings {
    return stringsFor(this.lang);
  }

  async start(view: MarkdownView, mode: LaunchMode = "text"): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice(this.rt.noNote);
      return;
    }
    const selection = view.editor.getSelection();
    const prepared = prepareInput(selection || view.editor.getValue(), {
      fromSelection: selection.length > 0,
      maxChars: this.plugin.settings.maxInputChars,
    });
    if (!prepared.ok) {
      new Notice(this.rt.tooShort);
      return;
    }
    if (!this.plugin.keys.get().trim()) {
      new Notice(this.rt.noKey);
      this.openSettings();
      return;
    }
    if (mode === "voice" && !this.plugin.settings.tts.enabled) {
      new Notice(this.rt.ttsOff);
      return;
    }

    this.close();
    if (mode === "voice" && !(await this.approveVoice(`${MIN_TURNS}–${MAX_TURNS}`))) return;

    const lineup = resolveLineup(this.plugin.settings.lineup);
    const memoryUse = await this.plugin.memory.useFor(file).catch((e: unknown) => {
      console.warn("[angel-and-devil] could not decide whether to use memory", e);
      return null;
    });
    this.session = {
      id: 0,
      mode,
      sourceFile: file,
      input: prepared.text,
      truncated: prepared.truncated,
      lineup,
      memory: memoryUse,
      replying: false,
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
        onReply: (text) => void this.reply(text),
        onClose: () => this.discard(),
      },
      {
        animation: this.plugin.settings.animation,
        revealSpeed: this.plugin.settings.revealSpeed,
        tts: this.plugin.settings.tts.enabled,
        reply: this.plugin.settings.reply.enabled,
        lineup,
        strings: this.rt,
        lang: this.lang,
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
    session.lastInput = undefined;
    session.replying = false;
    session.saved = false;
    session.savedBlock = undefined;
    session.savedAt = undefined;
    session.audio = undefined;
    modal.showLoading({ voice });

    const s = this.plugin.settings;
    let memory: LoadedMemory | undefined;
    if (session.memory) {
      try {
        memory = await this.plugin.memory.load(session.memory, session.sourceFile, session.lineup);
      } catch (e) {
        // Unreadable memory should not block the banter: go on without earlier memos.
        console.warn("[angel-and-devil] could not read memory", e);
        memory = { memos: {}, impressions: {}, count: 0 };
      }
      if (this.session?.id !== id) return;
    }
    const input: GenerateInput = {
      text: session.input,
      language: s.language,
      rounds: s.rounds,
      model: s.textModel,
      lineup: session.lineup,
      memory:
        memory && session.memory
          ? { kind: session.memory.kind, memos: memory.memos, impressions: memory.impressions }
          : undefined,
    };
    let dialogue: Dialogue;
    try {
      dialogue = await this.plugin.generator.generate(input);
    } catch (e) {
      if (this.session?.id !== id) return;
      modal.showError(toGeminiError(e));
      return;
    }
    if (this.session?.id !== id) return;
    session.dialogue = dialogue;
    session.lastInput = input;
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
    if (!session?.dialogue || session.saved || session.savedBlock) return;
    const now = new Date();
    const block = toMarkdown(session.dialogue, this.plugin.settings.headingTemplate, now, session.lineup);
    // Remembered before the write, so a reply that lands meanwhile still finds the block to replace.
    session.savedBlock = block;
    session.savedAt = now;
    const result = await this.plugin.writer.append(session.sourceFile, block);
    if (result === "not_found") {
      session.savedBlock = undefined;
      session.savedAt = undefined;
      new Notice(this.rt.sourceMissing);
      return;
    }
    session.saved = true;
    this.modal?.setSaved();
    new Notice(this.rt.savedNotice);
  }

  /**
   * Feature: reply. The user's one line after the banter; the pair answers with Counter → Lead.
   * Memory is rewritten (replacing today's record), a saved block is replaced, and audio is stitched on.
   */
  async reply(raw: string): Promise<void> {
    const session = this.session;
    const modal = this.modal;
    const before = session?.dialogue;
    if (!session || !modal || !before || !session.lastInput || before.reply || session.replying) return;
    const text = normalizeReply(raw);
    if (!text) return;
    session.replying = true;

    const s = this.plugin.settings;
    // Read-aloud launch: ask (and unlock audio on iOS) inside this click, before any other await.
    let voice = session.mode === "voice" && s.tts.enabled;
    if (voice) voice = await this.approveVoice(String(REPLY_TURNS));
    if (this.session !== session || session.dialogue !== before) return;

    const id = session.id;
    this.stopAudio();
    modal.showReplyLoading(text);
    let result: ReplyResult;
    try {
      result = await this.plugin.generator.reply({ base: session.lastInput, dialogue: before, replyText: text });
    } catch (e) {
      if (this.session?.id !== id) return;
      session.replying = false;
      modal.showReplyError(toGeminiError(e), text);
      return;
    }
    if (this.session?.id !== id) return;

    const dialogue: Dialogue = {
      ...before,
      reply: { text, turns: result.turns },
      memory: result.memory ?? before.memory,
    };
    session.dialogue = dialogue;
    session.replying = false;
    if (result.memory) this.recordMemory(session, dialogue);
    if (session.savedBlock) void this.resave(session, dialogue);

    if (!voice) {
      modal.showReply(dialogue, { reveal: "timer" });
      if (s.tts.enabled && s.tts.autoplay) void this.speakReply(session, before, dialogue);
      return;
    }

    // Read-aloud launch: keep "thinking" until the answer's voice is ready, then reveal it with the audio.
    const token = ++this.speakToken;
    const wav = await this.fetchReplyAudio(session, before, dialogue);
    if (this.session?.id !== id || session.dialogue !== dialogue || this.speakToken !== token) return;
    if (!wav) {
      modal.showReply(dialogue, { reveal: "timer" });
      return;
    }
    modal.showReply(dialogue, { reveal: "audio" });
    await this.play(session, dialogue, wav, token, dialogue.turns.length);
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
    if (!cached && !(await this.approveVoice(String(spokenTurns(dialogue).length)))) return;
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
    const { approved, dontAskAgain } = await confirmTts(
      this.plugin.app,
      { model: tts.model, turns },
      () => player.unlock(),
      this.rt,
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
        wav = await this.plugin.tts.synthesize(spokenTurns(dialogue), tts, session.lineup);
      } catch (e) {
        new Notice(this.rt[`err_${toGeminiError(e).kind}`]);
        return null;
      }
      this.remember(key, wav);
    }
    session.audio = { key, wav };
    return wav;
  }

  /**
   * Plays `wav`, which voices the spoken turns from `offset` on (0 = the whole banter; after a reply, the
   * banter's length = just the answer), driving the modal by spoken-turn index.
   */
  private async play(
    session: DialogueSession,
    dialogue: Dialogue,
    wav: Uint8Array,
    token: number,
    offset = 0,
  ): Promise<void> {
    const modal = this.modal;
    if (!modal) return;
    const current = () => this.session === session && session.dialogue === dialogue && this.speakToken === token;
    const timeline = new TurnTimeline(spokenTurns(dialogue).slice(offset));
    const speedMap = this.plugin.settings.tts.speed;
    const speed = speedMap[dialogue.language] ?? speedMap.en ?? 1.0;
    try {
      await this.ensurePlayer().play(wav, speed, {
        onFrame: (level, currentTime, duration) => {
          if (current()) modal.setActiveTurn(offset + timeline.indexAt(currentTime, duration), level);
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
    const use = session.memory;
    const memory = dialogue.memory;
    if (!use || !memory) return;
    const now = new Date();
    const lang = this.lang;
    this.memoryWrites = this.memoryWrites
      .then(() => this.plugin.memory.record(use, session.sourceFile, session.lineup, memory, now, lang))
      .catch((e) => {
        console.warn("[angel-and-devil] could not write memory", e);
        new Notice(this.rt.memoryWriteFailed);
      });
  }

  /** Text mode with autoplay: reads just the answer to the reply aloud (R-11). */
  private async speakReply(session: DialogueSession, before: Dialogue, dialogue: Dialogue): Promise<void> {
    const modal = this.modal;
    if (!modal) return;
    const token = ++this.speakToken;
    const player = this.ensurePlayer();
    player.stop();
    if (!this.plugin.settings.tts.confirmEveryTime) player.unlock();
    if (!(await this.approveVoice(String(REPLY_TURNS)))) return;
    const current = () => this.session === session && session.dialogue === dialogue && this.speakToken === token;
    if (!current()) return;
    modal.setAudioState("loading");
    const wav = await this.fetchReplyAudio(session, before, dialogue);
    if (!current()) return;
    if (!wav) {
      modal.setAudioState("idle");
      return;
    }
    await this.play(session, dialogue, wav, token, dialogue.turns.length);
  }

  /**
   * Synthesizes only the answer to the reply (two turns, one TTS chunk) and returns it, or null after a notice.
   * When the banter's audio is at hand, the answer is stitched onto it and cached as the whole exchange's audio,
   * so 🔊 replays everything without another call (R-11).
   */
  private async fetchReplyAudio(
    session: DialogueSession,
    before: Dialogue,
    dialogue: Dialogue,
  ): Promise<Uint8Array | null> {
    const reply = dialogue.reply;
    if (!reply) return null;
    const tts = this.plugin.settings.tts;
    let clip: Uint8Array;
    try {
      clip = await this.plugin.tts.synthesize(reply.turns, tts, session.lineup);
    } catch (e) {
      new Notice(this.rt[`err_${toGeminiError(e).kind}`]);
      return null;
    }
    const beforeKey = await audioKey(before, tts);
    const banterWav = session.audio?.key === beforeKey ? session.audio.wav : this.audioCache.get(beforeKey);
    if (banterWav) {
      const whole = concatPcmToWav([extractPcm(banterWav, "audio/wav"), extractPcm(clip, "audio/wav")], TTS_CHUNK_GAP_MS);
      const key = await audioKey(dialogue, tts);
      this.remember(key, whole);
      if (this.session === session && session.dialogue === dialogue) session.audio = { key, wav: whole };
    }
    return clip;
  }

  /** Swaps the saved block for the version with the reply, keeping its heading time (R-9). */
  private async resave(session: DialogueSession, dialogue: Dialogue): Promise<void> {
    const old = session.savedBlock;
    if (!old) return;
    const block = toMarkdown(dialogue, this.plugin.settings.headingTemplate, session.savedAt ?? new Date(), session.lineup);
    session.savedBlock = block;
    const result = await this.plugin.writer.replace(session.sourceFile, old, block);
    if (result === "not_found") {
      new Notice(this.rt.sourceMissing);
      return;
    }
    new Notice(result === "appended" ? this.rt.replyResaveAppended : this.rt.replySavedNotice);
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
  const text = JSON.stringify([tts.model, tts.voices, tts.styles, spokenTurns(dialogue)]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
