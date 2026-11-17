import type { Strings } from "../../src/i18n";
import type { DialogueUi, Notifier } from "../../src/ports";
import type { DialogueView, ModalHandlers, ModalOptions, TtsConfirmResult } from "../../src/ui/types";

type ViewCall = { [K in keyof DialogueView]: [K, ...Parameters<DialogueView[K]>] }[keyof DialogueView];

/** DialogueView that records what the controller asked it to show. */
export class FakeDialogueView implements DialogueView {
  readonly calls: ViewCall[] = [];

  constructor(
    readonly handlers: ModalHandlers,
    readonly options: ModalOptions,
  ) {}

  /** Names of the calls so far, in order. */
  names(): string[] {
    return this.calls.map((c) => c[0]);
  }

  showLoading(...a: Parameters<DialogueView["showLoading"]>): void {
    this.calls.push(["showLoading", ...a]);
  }
  setLoadingStep(...a: Parameters<DialogueView["setLoadingStep"]>): void {
    this.calls.push(["setLoadingStep", ...a]);
  }
  showDialogue(...a: Parameters<DialogueView["showDialogue"]>): void {
    this.calls.push(["showDialogue", ...a]);
  }
  showReplyLoading(...a: Parameters<DialogueView["showReplyLoading"]>): void {
    this.calls.push(["showReplyLoading", ...a]);
  }
  showReplyError(...a: Parameters<DialogueView["showReplyError"]>): void {
    this.calls.push(["showReplyError", ...a]);
  }
  showReply(...a: Parameters<DialogueView["showReply"]>): void {
    this.calls.push(["showReply", ...a]);
  }
  showError(...a: Parameters<DialogueView["showError"]>): void {
    this.calls.push(["showError", ...a]);
  }
  setAudioState(...a: Parameters<DialogueView["setAudioState"]>): void {
    this.calls.push(["setAudioState", ...a]);
  }
  setActiveTurn(...a: Parameters<DialogueView["setActiveTurn"]>): void {
    this.calls.push(["setActiveTurn", ...a]);
  }
  setSaved(): void {
    this.calls.push(["setSaved"]);
  }
  dismiss(): void {
    this.calls.push(["dismiss"]);
  }
}

/** DialogueUi that opens FakeDialogueViews and answers the TTS confirm as told. */
export class FakeDialogueUi implements DialogueUi {
  readonly views: FakeDialogueView[] = [];
  readonly confirms: Array<{ model: string; turns: string }> = [];
  settingsOpened = 0;
  /** The answer to the next TTS confirms. */
  confirmAnswer: TtsConfirmResult = { approved: true, dontAskAgain: false };

  get view(): FakeDialogueView | undefined {
    return this.views[this.views.length - 1];
  }

  openDialogue(handlers: ModalHandlers, options: ModalOptions): DialogueView {
    const view = new FakeDialogueView(handlers, options);
    this.views.push(view);
    return view;
  }

  async confirmTts(info: { model: string; turns: string }, onApprove: () => void, _s: Strings): Promise<TtsConfirmResult> {
    this.confirms.push(info);
    if (this.confirmAnswer.approved) onApprove();
    return this.confirmAnswer;
  }

  openSettings(): void {
    this.settingsOpened++;
  }
}

export class FakeNotifier implements Notifier {
  readonly messages: string[] = [];
  notify(message: string): void {
    this.messages.push(message);
  }
}
