import { type App, Notice } from "obsidian";
import type { Strings } from "../../i18n";
import type { DialogueUi, Notifier } from "../../ports";
import { confirmTts } from "../../ui/confirm";
import { DialogueModal } from "../../ui/modal";
import type { DialogueView, ModalHandlers, ModalOptions, TtsConfirmResult } from "../../ui/types";

export const obsidianNotifier: Notifier = {
  notify(message: string): void {
    new Notice(message);
  },
};

export class ObsidianDialogueUi implements DialogueUi {
  constructor(
    private readonly app: App,
    private readonly pluginId: string,
  ) {}

  openDialogue(handlers: ModalHandlers, options: ModalOptions): DialogueView {
    const modal = new DialogueModal(this.app, handlers, options);
    modal.open();
    return modal;
  }

  confirmTts(info: { model: string; turns: string }, onApprove: () => void, strings: Strings): Promise<TtsConfirmResult> {
    return confirmTts(this.app, info, onApprove, strings);
  }

  /** `app.setting` is not in Obsidian's public API; skip quietly if it is ever missing. */
  openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open(): void; openTabById(id: string): void };
    }).setting;
    if (!setting) return;
    setting.open();
    setting.openTabById(this.pluginId);
  }
}
