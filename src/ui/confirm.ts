import { App, Modal } from "obsidian";
import { t } from "../i18n";

export interface TtsConfirmResult {
  approved: boolean;
  /** The user ticked "Don't ask again" and pressed OK. Always false when cancelled. */
  dontAskAgain: boolean;
}

/**
 * Billing confirmation before calling Gemini TTS (F-6.2), same content as speak.py's confirm_tts_charge.
 * `onApprove` runs synchronously inside the OK click so audio can be unlocked within the gesture.
 * The "Don't ask again" box starts unchecked, so the default stays "confirm every time".
 */
export function confirmTts(
  app: App,
  info: { model: string; turns: string },
  onApprove: () => void,
): Promise<TtsConfirmResult> {
  return new Promise((resolve) => {
    let settled = false;
    const modal = new (class extends Modal {
      override onOpen(): void {
        this.modalEl.addClass("aad-confirm");
        this.setTitle(t.ttsConfirmTitle);
        this.contentEl.createEl("p", { text: t.ttsConfirmBody(info.model, info.turns) });
        const label = this.contentEl.createEl("label", { cls: "aad-confirm-dont-ask" });
        const dontAsk = label.createEl("input", { type: "checkbox" });
        label.createSpan({ text: t.ttsConfirmDontAsk });
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        const cancel = row.createEl("button", { text: t.cancel });
        const ok = row.createEl("button", { text: t.ttsConfirmOk, cls: "mod-cta" });
        cancel.addEventListener("click", () => this.close());
        ok.addEventListener("click", () => {
          settled = true;
          onApprove();
          resolve({ approved: true, dontAskAgain: dontAsk.checked });
          this.close();
        });
        window.setTimeout(() => ok.focus(), 0);
      }
      override onClose(): void {
        this.contentEl.empty();
        if (!settled) resolve({ approved: false, dontAskAgain: false });
      }
    })(app);
    modal.open();
  });
}
