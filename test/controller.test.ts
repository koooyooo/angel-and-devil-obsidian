import { describe, expect, it, vi } from "vitest";
import type { AudioPlayer } from "../src/audio/player";
import { DialogueController } from "../src/controller";
import { GeminiError } from "../src/gemini/errors";
import type { DialogueGenerator, ReplyResult } from "../src/gemini/generator";
import type { TtsService } from "../src/gemini/tts";
import { stringsFor } from "../src/i18n";
import { MemoryStore } from "../src/memory-store";
import type { Dialogue } from "../src/types";
import { NoteWriter } from "../src/writer";
import { FakeDailyNoteRules, FakeNoteStore } from "./fakes/notes";
import { FakeSecretStore, FakeSettingsStore } from "./fakes/settings";
import { FakeDialogueUi, FakeNotifier } from "./fakes/ui";

const en = stringsFor("en");
const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];
const NOTE_TEXT = "Today I finally rested and read a book in the park.";

const banter: Dialogue = {
  language: "en",
  turns: [
    { speaker: "angel", text: "You rested. Good." },
    { speaker: "devil", text: "Finally." },
  ],
  memory: {
    summary: "a rest day",
    notes: { angel: "rested in the park", devil: "read a book" },
    impressions: { angel: "works too hard", devil: "lazy at last" },
  },
};
const answer: ReplyResult = {
  turns: [
    { speaker: "devil", text: "Do it again." },
    { speaker: "angel", text: "Yes, please." },
  ],
};

function setup(o: { key?: string; saved?: Record<string, unknown>; generate?: () => Promise<Dialogue> } = {}) {
  const notes = new FakeNoteStore();
  const note = notes.add("daily/2026-11-03.md", NOTE_TEXT);
  const settings = new FakeSettingsStore(o.saved ?? {});
  const ui = new FakeDialogueUi();
  const notifier = new FakeNotifier();
  const generator = {
    generate: vi.fn(o.generate ?? (async () => banter)),
    reply: vi.fn(async () => answer),
  };
  const tts = { synthesize: vi.fn(async () => new Uint8Array([1, 2, 3])) };
  const player = { unlock: vi.fn(), stop: vi.fn(), dispose: vi.fn(), play: vi.fn(async () => {}) };
  const controller = new DialogueController({
    settings,
    secrets: new FakeSecretStore(o.key ?? "test-key-0000000000000000"),
    generator: generator as unknown as DialogueGenerator,
    tts: tts as unknown as TtsService,
    writer: new NoteWriter(notes),
    memory: new MemoryStore(notes, new FakeDailyNoteRules(), () => settings.get().memory),
    ui,
    notifier,
    env: { uiLanguage: "en", isMobile: false },
    createPlayer: () => player as unknown as AudioPlayer,
  });
  const launch = (mode: "text" | "voice" = "text", selection = "") =>
    controller.start({ note, text: notes.content(note.path) ?? "", selection }, mode);
  return { notes, note, settings, ui, notifier, generator, tts, player, controller, launch };
}

describe("DialogueController.start: checks before opening", () => {
  it("asks for a key and opens the settings when none is set", async () => {
    const { ui, notifier, generator, launch } = setup({ key: "  " });
    await launch();
    expect(notifier.messages).toEqual([en.noKey]);
    expect(ui.settingsOpened).toBe(1);
    expect(ui.views).toHaveLength(0);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("refuses a note that is too short", async () => {
    const { notes, note, ui, notifier, controller } = setup();
    await controller.start({ note, text: "short", selection: "" });
    expect(notifier.messages).toEqual([en.tooShort]);
    expect(ui.views).toHaveLength(0);
    expect(notes.content(note.path)).toBe(NOTE_TEXT);
  });

  it("refuses the read-aloud launch while TTS is off", async () => {
    const { ui, notifier, launch } = setup();
    await launch("voice");
    expect(notifier.messages).toEqual([en.ttsOff]);
    expect(ui.views).toHaveLength(0);
  });

  it("shows notices in the plugin's language", async () => {
    const { notifier, launch } = setup({ key: "", saved: { language: "ja" } });
    await launch();
    expect(notifier.messages).toEqual([stringsFor("ja").noKey]);
  });
});

describe("DialogueController: generate and show", () => {
  it("generates from the note and reveals the banter on a timer", async () => {
    const { ui, generator, launch } = setup();
    await launch();
    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ text: NOTE_TEXT, memory: undefined }));
    // generate() first stops any audio, then shows the loading screen.
    expect(ui.view?.names()).toEqual(["setAudioState", "showLoading", "showDialogue"]);
    expect(ui.view?.calls[2]).toEqual(["showDialogue", banter, { truncated: false, memoryCount: 0, reveal: "timer" }]);
    expect(ui.view?.options).toMatchObject({ tts: false, reply: true, lang: "en" });
  });

  it("uses the selection instead of the whole note", async () => {
    const { generator, launch } = setup();
    await launch("text", "Only this selected sentence, please.");
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Only this selected sentence, please." }),
    );
  });

  it("shows a generation error on the screen", async () => {
    const { ui, launch } = setup({
      generate: async () => {
        throw new GeminiError("quota", 429);
      },
    });
    await launch();
    expect(last(ui.view?.calls ?? [])).toEqual(["showError", expect.objectContaining({ kind: "quota" })]);
  });

  it("records memory as soon as the banter is shown, when memory is on", async () => {
    const { notes, generator, launch } = setup({ saved: { memory: { enabled: true } } });
    await launch();
    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ memory: expect.anything() }));
    await vi.waitFor(() => expect(notes.content("_angel_and_devil/history.md")).toContain("a rest day"));
    expect(notes.content("_angel_and_devil/angel_memo_diary.md")).toContain("rested in the park");
  });

  it("closes the screen and opens the settings from the error screen", async () => {
    const { ui, launch } = setup();
    await launch();
    const view = ui.view!;
    view.handlers.onOpenSettings();
    expect(last(view.names())).toBe("dismiss");
    expect(ui.settingsOpened).toBe(1);
  });
});

describe("DialogueController: save and reply", () => {
  it("appends the banter to the note once", async () => {
    const { notes, note, ui, notifier, controller, launch } = setup();
    await launch();
    await controller.save();
    await controller.save();
    const content = notes.content(note.path) ?? "";
    expect(content.startsWith(NOTE_TEXT)).toBe(true);
    expect(content).toContain("You rested. Good.");
    expect(content.match(/You rested\. Good\./g)).toHaveLength(1);
    expect(ui.view?.names()).toContain("setSaved");
    expect(notifier.messages).toEqual([en.savedNotice]);
  });

  it("saves to the note after it was renamed, and reports a deleted one", async () => {
    const first = setup();
    await first.launch();
    await first.notes.rename(first.note, "archive/rest.md");
    await first.controller.save();
    expect(first.notes.content("archive/rest.md")).toContain("You rested. Good.");

    const second = setup();
    await second.launch();
    second.notes.delete(second.note);
    await second.controller.save();
    expect(second.notifier.messages).toEqual([en.sourceMissing]);
    expect(second.ui.view?.names()).not.toContain("setSaved");
  });

  it("answers a reply and replaces the saved block with the version that has it", async () => {
    const { notes, note, ui, notifier, generator, controller, launch } = setup();
    await launch();
    await controller.save();
    await controller.reply("I will!");
    expect(generator.reply).toHaveBeenCalledWith(expect.objectContaining({ replyText: "I will!" }));
    expect(ui.view?.names().slice(-2)).toEqual(["showReplyLoading", "showReply"]);
    await vi.waitFor(() => expect(notifier.messages).toContain(en.replySavedNotice));
    const content = notes.content(note.path) ?? "";
    expect(content).toContain("Do it again.");
    expect(content.match(/You rested\. Good\./g)).toHaveLength(1);
  });

  it("allows only one reply", async () => {
    const { generator, controller, launch } = setup();
    await launch();
    await controller.reply("First");
    await controller.reply("Second");
    expect(generator.reply).toHaveBeenCalledTimes(1);
  });
});

describe("DialogueController: read aloud", () => {
  const ttsOn = { tts: { enabled: true } };

  it("asks before the paid TTS call and plays in step with the voice", async () => {
    const { ui, tts, player, launch } = setup({ saved: ttsOn });
    await launch("voice");
    expect(ui.confirms).toHaveLength(1);
    expect(player.unlock).toHaveBeenCalled();
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(ui.view?.names()).toEqual(["setAudioState", "showLoading", "setLoadingStep", "showDialogue", "setAudioState"]);
    expect(ui.view?.calls[3]).toEqual(["showDialogue", banter, expect.objectContaining({ reveal: "audio" })]);
    expect(ui.view?.calls[4]).toEqual(["setAudioState", "playing"]);
  });

  it("opens nothing and calls nothing when the confirm is cancelled", async () => {
    const { ui, tts, generator, launch } = setup({ saved: ttsOn });
    ui.confirmAnswer = { approved: false, dontAskAgain: false };
    await launch("voice");
    expect(ui.views).toHaveLength(0);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it("turns off 'confirm every time' after 'Don't ask again', and asks no more", async () => {
    const { ui, settings, controller, launch } = setup({ saved: ttsOn });
    ui.confirmAnswer = { approved: true, dontAskAgain: true };
    await launch("voice");
    expect(settings.get().tts.confirmEveryTime).toBe(false);
    expect(settings.saves).toBe(1);
    await controller.generate();
    expect(ui.confirms).toHaveLength(1);
  });

  it("reuses the cached voice for the 🔊 button without asking again", async () => {
    const { ui, tts, controller, launch } = setup({ saved: ttsOn });
    await launch("voice");
    await controller.speak();
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(ui.confirms).toHaveLength(1);
  });

  it("falls back to the text banter when TTS fails", async () => {
    const { ui, tts, notifier, launch } = setup({ saved: ttsOn });
    tts.synthesize.mockRejectedValueOnce(new GeminiError("server", 503));
    await launch("voice");
    expect(notifier.messages).toEqual([en.err_server]);
    expect(last(ui.view?.calls ?? [])).toEqual(["showDialogue", banter, expect.objectContaining({ reveal: "timer" })]);
  });
});
