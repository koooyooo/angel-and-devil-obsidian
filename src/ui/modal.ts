import { App, Modal, Platform, setIcon } from "obsidian";
import { BUILTIN_CHARACTERS, DEFAULT_LINEUP, charName } from "../characters";
import type { GeminiError } from "../gemini/errors";
import { USER_EMOJI, spokenTurns } from "../format";
import type { Strings } from "../i18n";
import { REPLY_MAX_CHARS, normalizeReply } from "../input";
import type { CharacterSpec, Dialogue, Lang, RevealSpeed, SlotRole, SpeakerId, Turn } from "../types";
import { revealDelay, scrollTopToReveal } from "./bubbles";
import { loadingTips } from "./loading-tips";

/** Callbacks to the controller. The modal never calls the generator, writer, etc. itself (design doc §2.2). */
export interface ModalHandlers {
  onSave(): void;
  onRetry(): void;
  onRegenerate(): void;
  onOpenSettings(): void;
  onSpeak(): void;
  onStopAudio(): void;
  /** The user sent their one reply (already normalized, never empty). */
  onReply(text: string): void;
  onClose(): void;
}

export interface ModalOptions {
  animation: boolean;
  revealSpeed: RevealSpeed;
  /** Shows the Read aloud button (Phase 2). */
  tts: boolean;
  /** Shows the reply box once the banter is done (feature: reply). */
  reply: boolean;
  lineup?: readonly [CharacterSpec, CharacterSpec];
  /** Strings and language of the launch (the plugin's language setting; see runtimeLanguage in i18n.ts). */
  strings: Strings;
  lang: Lang;
}

/**
 * How bubbles appear:
 * - "timer": one by one on a timer (click / Space to advance) — text mode.
 * - "audio": one by one as the voice reaches each turn — read-aloud launch.
 */
export type RevealMode = "timer" | "audio";

/** Loading screen steps. "voice" is only shown for the read-aloud launch. */
export type LoadingStep = "write" | "voice";

type State = "loading" | "revealing" | "done" | "error" | "replyLoading";

/**
 * What the log shows, in order: the banter's turns, then (after a reply) the user's line and the pair's answer.
 * `index` counts spoken turns only (see spokenTurns), which is what the audio timeline reports.
 */
type LogItem = { kind: "turn"; turn: Turn; index: number } | { kind: "user"; text: string };

function logItems(dialogue: Dialogue): LogItem[] {
  const items: LogItem[] = dialogue.turns.map((turn, index) => ({ kind: "turn", turn, index }));
  if (dialogue.reply) {
    items.push({ kind: "user", text: dialogue.reply.text });
    const offset = dialogue.turns.length;
    dialogue.reply.turns.forEach((turn, i) => items.push({ kind: "turn", turn, index: offset + i }));
  }
  return items;
}
export type AudioState = "idle" | "loading" | "playing" | "ended";

const TIP_INTERVAL_MS = 6000;

interface CharSlotView {
  spec: CharacterSpec;
  role: SlotRole;
  root: HTMLElement;
  status: HTMLElement;
}

/** DialogueModal (design doc §2.2, §5.7): the stage, the bubbles, and the buttons. */
export class DialogueModal extends Modal {
  private state: State = "loading";
  private revealMode: RevealMode = "timer";
  private dialogue: Dialogue | null = null;
  private items: LogItem[] = [];
  private shown = 0;
  /** What is typed in the reply box, kept across re-renders and after a failed reply. */
  private replyDraft = "";
  private replyError: string | null = null;
  private timer: number | undefined;
  private speakingTimer: number | undefined;
  private tipTimer: number | undefined;
  private closedByController = false;

  private stageEl!: HTMLElement;
  private logEl!: HTMLElement;
  private noticeEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private replyEl!: HTMLElement;
  private slots: [CharSlotView, CharSlotView] | null = null;
  private stepEls: Partial<Record<LoadingStep, HTMLElement>> = {};
  private saveButton: HTMLButtonElement | null = null;
  private speakButton: HTMLButtonElement | null = null;
  private audioState: AudioState = "idle";
  private playingIndex = -1;
  private saved = false;

  constructor(
    app: App,
    private readonly handlers: ModalHandlers,
    private readonly options: ModalOptions,
  ) {
    super(app);
  }

  private get s(): Strings {
    return this.options.strings;
  }

  private get lineup(): readonly [CharacterSpec, CharacterSpec] {
    return this.options.lineup ?? DEFAULT_LINEUP;
  }

  private get motion(): boolean {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    return this.options.animation && !reduce;
  }

  override onOpen(): void {
    this.containerEl.addClass("aad-container");
    this.modalEl.addClass("aad-modal");
    if (Platform.isMobile) this.modalEl.addClass("aad-mobile");
    if (!this.motion) this.modalEl.addClass("aad-no-motion");

    const { contentEl } = this;
    contentEl.empty();
    // `lang` lets the browser pick the right CJK glyphs (Chinese vs Japanese) and hyphenation for the screen text.
    const panel = contentEl.createDiv({ cls: "aad-panel", attr: { lang: this.options.lang } });

    const header = panel.createDiv({ cls: "aad-header" });
    header.createDiv({ cls: "aad-title", text: this.s.pluginName });
    // Our own close button: Obsidian's built-in one is hidden by CSS because its markup varies by version.
    const closeButton = header.createEl("button", { cls: "aad-close", attr: { type: "button", "aria-label": this.s.close } });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());

    this.stageEl = panel.createDiv({ cls: "aad-stage" });
    this.stageEl.createDiv({ cls: "aad-burst", attr: { "aria-hidden": "true" } });
    const [leadSpec, counterSpec] = this.lineup;
    const leadSlot = this.buildChar(leadSpec, "lead");
    const counterSlot = this.buildChar(counterSpec, "counter");
    this.slots = [leadSlot, counterSlot];

    this.logEl = this.stageEl.createDiv({ cls: "aad-log", attr: { "aria-live": "polite" } });
    // Order for layout: lead | log | counter.
    this.stageEl.append(leadSlot.root, this.logEl, counterSlot.root);
    this.stageEl.addEventListener("click", () => {
      if (this.state === "revealing" && this.revealMode === "timer") this.revealNext();
    });

    this.noticeEl = panel.createDiv({ cls: "aad-notice" });
    this.replyEl = panel.createDiv({ cls: "aad-reply" });
    this.actionsEl = panel.createDiv({ cls: "aad-actions" });

    // Space advances the bubbles (F-4.5). Buttons and the reply box keep their own Space behaviour (R-6).
    this.modalEl.addEventListener("keydown", (evt) => {
      if (evt.key !== " " || this.state !== "revealing" || this.revealMode !== "timer") return;
      if (evt.target instanceof HTMLButtonElement || evt.target instanceof HTMLInputElement) return;
      evt.preventDefault();
      this.revealNext();
    });

    this.showLoading({ voice: false });
  }

  override onClose(): void {
    this.clearTimers();
    this.contentEl.empty();
    if (!this.closedByController) this.handlers.onClose();
  }

  /** Close initiated by the controller: do not echo onClose back to it. */
  dismiss(): void {
    this.closedByController = true;
    this.close();
  }

  /** Loading screen with progress steps and rotating tip cards (like a game's loading screen). */
  showLoading(options: { voice: boolean }): void {
    this.clearTimers();
    this.state = "loading";
    this.dialogue = null;
    this.items = [];
    this.replyDraft = "";
    this.replyError = null;
    this.saved = false;
    this.audioState = "idle";
    this.playingIndex = -1;
    this.shown = 0;
    this.stageEl.removeClass("is-audio");
    this.stageEl.addClass("is-loading");
    this.logEl.empty();
    this.noticeEl.empty();
    this.setSpeaking(null);

    const loading = this.logEl.createDiv({ cls: "aad-loading" });
    const steps = loading.createEl("ol", { cls: "aad-steps" });
    this.stepEls = {};
    const stepList: Array<[LoadingStep, string]> = [["write", this.s.stepWrite]];
    if (options.voice) stepList.push(["voice", this.s.stepVoice]);
    for (const [key, label] of stepList) {
      const li = steps.createEl("li", { cls: "aad-step" });
      li.createSpan({ cls: "aad-step-mark", attr: { "aria-hidden": "true" } });
      li.createSpan({ cls: "aad-step-label", text: label });
      this.stepEls[key] = li;
    }
    this.setLoadingStep("write");

    const card = loading.createDiv({ cls: "aad-tip" });
    card.createDiv({ cls: "aad-tip-label", text: this.s.tipLabel });
    const tipText = card.createDiv({ cls: "aad-tip-text" });
    const tips = loadingTips(this.s);
    let i = 0;
    const showTip = () => {
      tipText.removeClass("is-in");
      // Restart the fade-in animation.
      void tipText.offsetWidth;
      tipText.setText(tips[i % tips.length]);
      tipText.addClass("is-in");
      i++;
    };
    showTip();
    this.tipTimer = window.setInterval(showTip, TIP_INTERVAL_MS);

    this.renderActions();
  }

  setLoadingStep(step: LoadingStep): void {
    const order: LoadingStep[] = ["write", "voice"];
    const current = order.indexOf(step);
    for (const key of order) {
      const el = this.stepEls[key];
      if (!el) continue;
      const idx = order.indexOf(key);
      el.toggleClass("is-done", idx < current);
      el.toggleClass("is-active", idx === current);
    }
  }

  showDialogue(dialogue: Dialogue, options: { truncated: boolean; memoryCount?: number; reveal: RevealMode }): void {
    this.clearTimers();
    this.state = "revealing";
    this.revealMode = options.reveal;
    this.dialogue = dialogue;
    this.items = logItems(dialogue);
    this.replyDraft = "";
    this.replyError = null;
    this.shown = 0;
    this.logEl.empty();
    this.noticeEl.empty();
    this.stageEl.removeClass("is-loading");
    const notices: string[] = [];
    if (options.truncated) notices.push(this.s.truncated);
    if (options.memoryCount) notices.push(this.s.memoryUsed(options.memoryCount));    this.noticeEl.setText(notices.join(" "));
    this.renderActions();
    if (options.reveal === "audio") return; // bubbles follow setActiveTurn()
    if (this.motion) this.revealNext();
    else this.revealAll();
  }

  /** The user's line goes up at once; the pair "thinks" below it until showReply / showReplyError (R-2, R-7). */
  showReplyLoading(text: string): void {
    this.clearTimers();
    this.state = "replyLoading";
    this.replyDraft = text;
    this.replyError = null;
    this.setSpeaking(null);
    this.removePending();
    this.logEl.querySelectorAll(".aad-bubble.is-current").forEach((b) => b.removeClass("is-current"));
    this.createUserBubble(text).addClass("aad-reply-pending");
    const thinking = this.logEl.createDiv({
      cls: "aad-reply-thinking aad-reply-pending",
      attr: { role: "status", "aria-label": this.s.thinking },
    });
    for (let i = 0; i < 3; i++) thinking.createSpan({ cls: "aad-reply-dot" });
    this.scrollToBubble(thinking);
    this.renderActions();
  }

  /** The reply failed: the banter stays, the reply box comes back with the text and the error (R-7). */
  showReplyError(error: GeminiError, text: string): void {
    this.clearTimers();
    this.removePending();
    this.state = "done";
    this.replyDraft = text;
    this.replyError = this.s[`err_${error.kind}`];
    this.renderActions();
  }

  /** Reveals the pair's answer below the user's line, the same way as the banter (R-3). */
  showReply(dialogue: Dialogue, options: { reveal: RevealMode }): void {
    this.clearTimers();
    this.logEl.querySelectorAll(".aad-reply-thinking").forEach((el) => el.remove());
    this.logEl.querySelectorAll(".aad-reply-pending").forEach((el) => el.removeClass("aad-reply-pending"));
    this.dialogue = dialogue;
    this.items = logItems(dialogue);
    // The banter and the user's line are already on screen.
    this.shown = dialogue.turns.length + 1;
    this.replyDraft = "";
    this.replyError = null;
    this.state = "revealing";
    this.revealMode = options.reveal;
    this.renderActions();
    if (options.reveal === "audio") return;
    if (this.motion) this.revealNext();
    else this.revealAll();
  }

  showError(error: GeminiError): void {
    this.clearTimers();
    this.state = "error";
    this.stageEl.removeClass("is-loading");
    this.setSpeaking(null);
    this.logEl.empty();
    this.logEl.createDiv({ cls: "aad-error", text: this.s[`err_${error.kind}`] });
    this.renderActions(error.kind === "invalid_key" || error.kind === "model_not_found");
  }

  /** Read-aloud progress (design doc §2.1 ⑤). */
  setAudioState(state: AudioState): void {
    this.audioState = state;
    // Text mode: reading aloud mid-reveal shows everything at once.
    if (state === "playing" && this.state === "revealing" && this.revealMode === "timer") this.revealAll();
    this.stageEl.toggleClass("is-audio", state === "playing");
    if (state !== "playing") {
      this.playingIndex = -1;
      this.logEl.querySelectorAll(".aad-bubble.is-playing").forEach((b) => b.removeClass("is-playing"));
      this.setLevel(0);
      // Audio mode: when the voice ends (or stops / fails), show whatever is left and finish.
      if (this.state === "revealing" && this.revealMode === "audio" && state !== "loading") this.revealAll();
      if (this.state === "done") this.setSpeaking(null);
    }
    if (this.state === "revealing" && this.revealMode === "audio") this.renderActions();
    this.updateSpeakButton();
  }

  /** Called every frame while playing: reveal / highlight the turn being read and drive the characters. */
  setActiveTurn(index: number, level: number): void {
    if (!this.dialogue || this.audioState !== "playing") return;
    if (index !== this.playingIndex) {
      this.playingIndex = index;
      if (this.state === "revealing" && this.revealMode === "audio") {
        while (this.shown < this.items.length) {
          const item = this.items[this.shown];
          if (item.kind === "turn" && item.index > index) break;
          this.appendItem(this.shown++);
        }
      }
      // Only spoken turns carry data-turn: the user's bubble is never read aloud.
      let playing: HTMLElement | undefined;
      this.logEl.querySelectorAll<HTMLElement>(".aad-bubble").forEach((b) => {
        const on = b.dataset.turn !== undefined && Number(b.dataset.turn) === index;
        b.toggleClass("is-playing", on);
        b.toggleClass("is-current", on);
        if (on) playing = b;
      });
      if (playing) this.scrollToBubble(playing);
      const turn = spokenTurns(this.dialogue)[index];
      if (turn) this.setSpeaking(turn.speaker);
    }
    this.setLevel(level);
  }

  setSaved(): void {
    this.saved = true;
    if (!this.saveButton) return;
    this.saveButton.setText(this.s.saved);
    this.saveButton.disabled = true;
  }

  // --- internals ---

  private displayLabel(spec: CharacterSpec): string {
    if (spec.id === "angel") return this.s.angel;
    if (spec.id === "devil") return this.s.devil;
    return charName(spec, this.dialogue?.language ?? "ja");
  }

  private applyThemeVars(el: HTMLElement, spec: CharacterSpec): void {
    el.style.setProperty("--aad-char-primary", spec.theme.primary);
    el.style.setProperty("--aad-char-frame-bg", spec.theme.frameBg);
    el.style.setProperty("--aad-char-name-color", spec.theme.nameColor);
    el.style.setProperty("--aad-char-burst", spec.theme.burstColor);
  }

  private buildChar(spec: CharacterSpec, role: SlotRole): CharSlotView {
    const label = this.displayLabel(spec);
    const root = createDiv({ cls: `aad-char is-${role} is-${spec.id}` });
    this.applyThemeVars(root, spec);
    const frame = root.createDiv({ cls: "aad-char-frame" });
    spec.renderAvatar(frame, label);
    root.createDiv({ cls: "aad-char-name", text: label });
    const status = root.createDiv({ cls: "aad-char-status", text: this.s.standby });
    return { spec, role, root, status };
  }

  private setSpeaking(speaker: SpeakerId | null): void {
    if (!this.slots) return;
    for (const slot of this.slots) {
      const on = slot.spec.id === speaker;
      slot.root.toggleClass("is-speaking", on);
      slot.status.setText(on ? this.s.speaking : this.s.standby);
      if (on) {
        this.stageEl.style.setProperty("--aad-burst-color", slot.spec.theme.burstColor);
      }
    }
  }

  private setLevel(level: number): void {
    if (!this.slots) return;
    const v = (Math.round(level * 100) / 100).toString();
    for (const slot of this.slots) {
      slot.root.style.setProperty("--aad-level", v);
    }
  }

  private updateSpeakButton(): void {
    const b = this.speakButton;
    if (!b) return;
    const label = { idle: this.s.speak, loading: this.s.speakLoading, playing: this.s.speakStop, ended: this.s.speakAgain }[this.audioState];
    b.setText(label);
    b.disabled = this.audioState === "loading";
    b.toggleClass("is-active", this.audioState === "playing");
  }

  private resolveTurnSlot(speakerId: SpeakerId): { spec: CharacterSpec; role: SlotRole } {
    const [leadSpec, counterSpec] = this.lineup;
    if (speakerId === counterSpec.id) return { spec: counterSpec, role: "counter" };
    if (speakerId === leadSpec.id) return { spec: leadSpec, role: "lead" };
    const fallback = BUILTIN_CHARACTERS[speakerId] ?? leadSpec;
    return { spec: fallback, role: speakerId === "devil" ? "counter" : "lead" };
  }

  private appendItem(position: number): void {
    const item = this.items[position];
    if (item.kind === "user") this.createUserBubble(item.text);
    else this.appendBubble(item.turn, item.index);
  }

  private createUserBubble(text: string): HTMLElement {
    this.logEl.querySelectorAll(".aad-bubble.is-current").forEach((b) => b.removeClass("is-current"));
    const bubble = this.logEl.createDiv({ cls: "aad-bubble is-user is-current" });
    bubble.createDiv({ cls: "aad-nameplate", text: `${USER_EMOJI} ${this.s.you}` });
    bubble.createDiv({ cls: "aad-bubble-body", text });
    this.scrollToBubble(bubble);
    return bubble;
  }

  private removePending(): void {
    this.logEl.querySelectorAll(".aad-reply-pending").forEach((el) => el.remove());
  }

  private appendBubble(turn: Turn, index: number): void {
    const { spec, role } = this.resolveTurnSlot(turn.speaker);
    this.logEl.querySelectorAll(".aad-bubble.is-current").forEach((b) => b.removeClass("is-current"));
    const bubble = this.logEl.createDiv({
      cls: `aad-bubble is-${role} is-${turn.speaker} is-current`,
      attr: { "data-turn": String(index) },
    });
    this.applyThemeVars(bubble, spec);
    bubble.createDiv({ cls: "aad-nameplate", text: this.displayLabel(spec) });
    // The banter may be in another language than the UI (e.g. a French note in a Japanese Obsidian).
    bubble.createDiv({ cls: "aad-bubble-body", text: turn.text, attr: { lang: this.dialogue!.language } });
    this.scrollToBubble(bubble);
  }

  /**
   * Scrolls the log so the bubble is fully visible, along with the log's padding (which also leaves room for the
   * bubble's offset shadow). Not scrollIntoView(): it stops at the border box and measures the scaled-down box
   * while the pop-in animation runs, so it falls short and clips the bottom of the bubble.
   */
  private scrollToBubble(bubble: HTMLElement): void {
    const log = this.logEl;
    const style = getComputedStyle(log);
    const top = scrollTopToReveal({
      scrollTop: log.scrollTop,
      viewHeight: log.clientHeight,
      itemTop: bubble.offsetTop,
      itemBottom: bubble.offsetTop + bubble.offsetHeight,
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
    });
    log.scrollTo({ top, behavior: this.motion ? "smooth" : "auto" });
  }

  private revealNext(): void {
    if (!this.dialogue) return;
    window.clearTimeout(this.timer);
    const items = this.items;
    if (this.shown >= items.length) return;

    const position = this.shown++;
    this.appendItem(position);
    const item = items[position];
    const text = item.kind === "turn" ? item.turn.text : item.text;
    const delay = revealDelay(text.length, this.options.revealSpeed);
    this.setSpeaking(item.kind === "turn" ? item.turn.speaker : null);

    if (this.shown < items.length) {
      this.timer = window.setTimeout(() => this.revealNext(), delay);
    } else {
      this.finish();
      window.clearTimeout(this.speakingTimer);
      this.speakingTimer = window.setTimeout(() => this.setSpeaking(null), delay);
    }
  }

  private revealAll(): void {
    if (!this.dialogue) return;
    window.clearTimeout(this.timer);
    while (this.shown < this.items.length) this.appendItem(this.shown++);
    this.setSpeaking(null);
    this.finish();
  }

  private finish(): void {
    this.state = "done";
    this.renderActions();
    // The final buttons can wrap and shrink the log, so aim again with its final height.
    const last = this.logEl.querySelector<HTMLElement>(".aad-bubble:last-child");
    if (last) this.scrollToBubble(last);
  }

  /** The one-line reply box (R-1, R-4, R-5, R-6): only once the banter is done and not yet replied to. */
  private renderReply(): void {
    const el = this.replyEl;
    el.empty();
    const show = this.state === "done" && this.options.reply && !!this.dialogue && !this.dialogue.reply;
    el.toggleClass("is-hidden", !show);
    if (!show) return;
    if (this.replyError) el.createDiv({ cls: "aad-reply-error", text: this.replyError });
    const form = el.createEl("form", { cls: "aad-reply-form" });
    const input = form.createEl("input", {
      cls: "aad-reply-input",
      attr: {
        type: "text",
        maxlength: String(REPLY_MAX_CHARS),
        placeholder: this.s.replyPlaceholder,
        "aria-label": this.s.replyLabel,
        enterkeyhint: "send",
        autocomplete: "off",
      },
    });
    input.value = this.replyDraft;
    const send = form.createEl("button", {
      cls: "aad-button is-secondary aad-reply-send",
      text: this.s.replySend,
      attr: { type: "submit" },
    });
    const sync = () => {
      send.disabled = normalizeReply(input.value) === "";
    };
    sync();
    input.addEventListener("input", () => {
      this.replyDraft = input.value;
      sync();
    });
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") return; // still closes the modal
      // Keep typing away from the modal's Space handler and Obsidian's hotkeys.
      evt.stopPropagation();
      // Enter that confirms an IME conversion must not send (R-5).
      if (evt.key === "Enter" && (evt.isComposing || evt.keyCode === 229)) evt.preventDefault();
    });
    // On mobile the keyboard slides up: keep the box in view.
    input.addEventListener("focus", () => window.setTimeout(() => input.scrollIntoView({ block: "nearest" }), 300));
    form.addEventListener("click", (evt) => evt.stopPropagation());
    form.addEventListener("submit", (evt) => {
      evt.preventDefault();
      const text = normalizeReply(input.value);
      if (text) this.handlers.onReply(text);
    });
  }

  private renderActions(showSettings = false): void {
    this.renderReply();
    this.actionsEl.empty();
    this.saveButton = null;
    this.speakButton = null;
    const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = this.actionsEl.createEl("button", { text, cls: `aad-button ${cls}` });
      b.addEventListener("click", (evt) => {
        evt.stopPropagation();
        onClick();
      });
      return b;
    };

    switch (this.state) {
      case "loading":
        break;
      case "revealing":
        if (this.revealMode === "audio") {
          // While the voice leads, the only control is to stop it (the rest of the text then appears).
          if (this.audioState === "playing") button(this.s.speakStop, "is-secondary is-speak is-active", () => this.handlers.onStopAudio());
        } else {
          button(this.s.skip, "is-secondary", () => this.revealAll());
        }
        break;
      case "done":
        button(this.s.close, "is-tertiary", () => this.close());
        if (this.options.tts) {
          this.speakButton = button(this.s.speak, "is-secondary is-speak", () =>
            this.audioState === "playing" ? this.handlers.onStopAudio() : this.handlers.onSpeak(),
          );
          this.updateSpeakButton();
        }
        button(this.s.again, "is-secondary", () => this.handlers.onRegenerate());
        this.saveButton = button(this.s.save, "is-primary", () => this.handlers.onSave());
        if (this.saved) this.setSaved();
        break;
      case "replyLoading":
        button(this.s.close, "is-tertiary", () => this.close());
        break;
      case "error":
        button(this.s.close, "is-tertiary", () => this.close());
        if (showSettings) button(this.s.openSettings, "is-secondary", () => this.handlers.onOpenSettings());
        button(this.s.retry, "is-primary", () => this.handlers.onRetry());
        break;
    }
  }

  private clearTimers(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.speakingTimer);
    window.clearInterval(this.tipTimer);
  }
}
