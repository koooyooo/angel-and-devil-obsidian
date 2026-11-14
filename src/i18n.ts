import { getLanguage } from "obsidian";
import { uiLanguageFor } from "./lang";
import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";
import type { NoteKind } from "./memory";
import type { Lang } from "./types";

const ja = {
  pluginName: "天使と悪魔",
  angel: "天使",
  devil: "悪魔",
  commandStart: "掛け合いを開始",
  actionTitle: "天使と悪魔の掛け合い",
  thinking: "ノートを読んでいます…",
  speaking: "話し中",
  standby: "スタンバイ",
  skip: "スキップ",
  again: "もう一度",
  save: "ノート末尾に保存する",
  saved: "保存済み",
  retry: "再試行",
  openSettings: "設定を開く",
  close: "閉じる",
  truncated: "ノートが長いため、先頭の一部だけを読みました。",
  savedNotice: "ノートに保存しました。",
  sourceMissing: "元のノートが見つからないため、保存できませんでした。",
  noNote: "Markdown のノートを開いてから実行してください。",
  tooShort: "ノートの内容が短すぎます。もう少し書いてから試してください。",
  noKey: "Gemini の API キーが設定されていません。設定画面で入力してください。",
  err_invalid_key: "API キーが正しくないようです。設定を確認してください。",
  err_model_not_found: "指定したモデルが見つかりません。設定のモデル名を確認してください。",
  err_quota: "利用の上限に達しました。少し待ってからもう一度お試しください。",
  err_server: "Gemini に接続できませんでした。",
  err_network: "Gemini に接続できませんでした。ネットワークを確認してください。",
  err_timeout: "Gemini からの応答がありませんでした。",
  err_blocked: "内容が安全フィルタに引っかかったため、掛け合いを作れませんでした。一部を選択して試してみてください。",
  err_bad_output: "うまく掛け合いを作れませんでした。",
  err_unknown: "予期しないエラーが発生しました。",
  // settings
  setApiKey: "Gemini API キー",
  setApiKeyDesc: "ノートはボタンを押したときだけ送信されます",
  setApiKeyStoredSecret: "キーはシークレットストレージに保存されます",
  setApiKeyStoredPlain: "キーは data.json に平文で保存されます（Vault の同期・共有に注意）",
  setGetKey: "Google AI Studio でキーを取得",
  setApiKeySaved: (hint: string) => (hint ? `✓ キーは保存済みです（末尾 ••••${hint}）。` : "✓ キーは保存済みです。"),
  setApiKeyNotSaved: "キーはまだ保存されていません。",
  setApiKeyPlaceholderReplace: "変更するときだけ新しいキーを入力",
  setApiKeySave: "保存",
  setApiKeyDelete: "削除",
  setApiKeyEmpty: "キーを入力してから保存してください。",
  setApiKeySavedNotice: "API キーを保存しました。",
  setApiKeyDeletedNotice: "API キーを削除しました。",
  setCheckKey: "キーを確認",
  setCheckOk: "キーを確認できました。",
  setModel: "テキストモデル",
  setModelDesc: "掛け合いの生成に使う Gemini のモデル名。",
  setLanguage: "言語",
  setLanguageDesc:
    "掛け合いと、起動した画面（ロード画面・ボタン・通知・読み上げの確認）、記憶ファイルの言語です。「ノートに合わせる」では、掛け合いはノートの言語、画面は Obsidian の言語になります。この設定画面とコマンド名はいつも Obsidian の言語です。",
  setLanguageAuto: "ノートに合わせる",
  setRounds: "往復の数",
  setRoundsAuto: "おまかせ",
  setRounds2: "2 往復",
  setRounds3: "3 往復",
  setAnimation: "アニメーション",
  setAnimationDesc: "OS で「視差効果を減らす」がオンのときは、この設定に関係なく止まります。",
  setSpeed: "吹き出しの表示速度",
  setSpeedSlow: "ゆっくり",
  setSpeedNormal: "ふつう",
  setSpeedFast: "はやい",
  setHeading: "保存時の見出し",
  setHeadingDesc: "{{date}} と {{time}} が日時に、{{title}} が掛け合いの言語のプラグイン名に置き換わります。空にすると見出しなしで保存します。",
  setRibbon: "リボンにアイコンを表示",
  setStatusBar: "ステータスバーにボタンを表示（デスクトップのみ）",
  setMaxChars: "読み込む最大文字数",
  setMaxCharsDesc: "これより長いノートは先頭だけを送ります。",
  // tts
  speak: "🔊 読み上げ",
  speakLoading: "音声を準備中…",
  speakStop: "■ 停止",
  speakAgain: "🔊 もう一度再生",
  cancel: "キャンセル",
  ttsConfirmTitle: "Gemini TTS で読み上げます",
  ttsConfirmBody: (model: string, turns: string) =>
    `Gemini TTS（モデル: ${model}、${turns} ターン）を呼び出して音声を作ります。Google アカウントに料金が発生する場合があります。よろしいですか？`,
  ttsOff: "読み上げが無効になっています。設定の「読み上げを有効にする」をオンにしてください。",
  commandStartVoice: "読み上げ付きで掛け合いを開始",
  actionTitleVoice: "読み上げ付きで掛け合い",
  stepWrite: "天使と悪魔が掛け合いを考えています",
  stepVoice: "声を吹き込んでいます",
  tipLabel: "ひとこと",
  ttsConfirmOk: "読み上げる",
  ttsConfirmDontAsk: "今後は確認しない（設定の「毎回確認する」で元に戻せます）",
  setTtsHeading: "読み上げ（Gemini TTS）",
  setTtsEnabled: "読み上げを有効にする",
  setTtsEnabledDesc: "掛け合いの画面に「読み上げ」ボタンを出します。音声の生成はテキストより料金が高くなることがあります。",
  setTtsModel: "TTS モデル",
  setTtsConfirm: "毎回確認する",
  setTtsConfirmDesc: "オフにすると、確認なしで Gemini TTS を呼び出します（同じ掛け合いの再生はキャッシュを使い、料金はかかりません）。",
  setTtsAutoplay: "自動で読み上げる",
  setTtsAutoplayDesc: "掛け合いが表示されたら自動で読み上げます。「毎回確認する」がオンのときは確認が出ます。",
  setTtsSpeedJa: "再生速度（日本語）",
  setTtsSpeedEn: "再生速度（英語・その他の言語）",
  setTtsVoiceAngel: "天使の声",
  setTtsVoiceDevil: "悪魔の声",
  setTtsStyleAngel: "天使の話し方",
  setTtsStyleDevil: "悪魔の話し方",
  setTtsStyleDesc: "英語で書くのがおすすめです（例: warm, bright, polite）。",
  // memory
  setMemoryHeading: "記憶",
  setMemoryEnabled: "掛け合いを記憶する",
  setMemoryEnabledDesc:
    "掛け合いのたびに（保存しなくても）、2人がそれぞれメモを残し、あなたへの全体的な印象も書き直します。次からは印象と直近のメモを踏まえて、同じ指摘を繰り返さずに話します。メモは日記とそれ以外のノート（記事・読書メモなど）で分けて残し、それぞれ同じ種類のメモだけを使います。印象は両方から作る 1 つです。日記として扱うのは、コアプラグイン「デイリーノート」のフォルダと日付の書式に合うノートです（デイリーノートが未設定なら、ファイル名が 2026-11-12 のような日付で始まるノート）。個別のノートは、プロパティ angel-and-devil-kind を diary / content にして決められます。同じノートを同じ日にもう一度掛け合うと、その日の分は新しい内容で置き換わります。どれも Vault 内のフォルダに普通のノートとして残るので、読んだり直したり消したりできます。オンの間は、メモと印象の内容もノートと一緒に Gemini API に送られます。",
  setMemoryFolder: "記憶フォルダ",
  setMemoryFolderDesc:
    "history.md と、キャラクターごとのメモ（angel_memo_diary.md / angel_memo_content.md など）・印象（angel_impression.md など）を置くフォルダ。「.」で始まるフォルダは Obsidian から見えないため使えません。",
  setMemoryFolderInvalid: "このフォルダ名は使えません。「.」で始まる名前や、* \" < > : | ? を含む名前は指定できません。",
  memoryWriteFailed: "記憶の書き込みに失敗しました。",
  memoryUsed: (n: number) => `過去のメモ ${n} 件も踏まえて話しています。`,
  // reply
  you: "あなた",
  replyPlaceholder: "ひとこと返す…",
  replySend: "送る",
  replyLabel: "掛け合いへの返信",
  replySavedNotice: "返信もノートに保存しました。",
  replyResaveAppended: "保存済みの掛け合いが見つからなかったため、返信入りの掛け合いをノート末尾に追加しました。",
  setReply: "返信欄を表示する",
  setReplyDesc:
    "掛け合いの最後に、ひとこと返せる入力欄を出します。返信すると悪魔と天使が 1 往復だけ応えます（1 つの掛け合いにつき 1 回。テキスト生成が 1 回増えます）。",
  memoTitle: (emoji: string, name: string, kind: NoteKind) =>
    `# ${emoji} ${name}のメモ（${kind === "diary" ? "日記" : "コンテンツ"}）`,
  memoNote: (max: number, kind: NoteKind) =>
    `%% 天使と悪魔の記憶です。${kind === "diary" ? "日記" : "日記以外のノート（記事・読書メモなど）"}の掛け合いのたびに下へ追加され（同じノート・同じ日の分は置き換え）、直近 ${max} 件だけが残ります。自由に直したり消したりできます。 %%`,
  impressionTitle: (emoji: string, name: string) => `# ${emoji} ${name}から見たあなた`,
  impressionNote: (max: number) =>
    `%% 天使と悪魔の記憶です。掛け合いのたびに、前回の印象と今日のノートから書き直した版が下へ追加され（同じノート・同じ日の分は置き換え）、直近 ${max} 版だけが残ります。次の掛け合いで使われるのは一番下の版です。自由に直せます。 %%`,
  historyTitle: "# 😇😈 掛け合いの履歴",
  historyNote: "%% 掛け合いの一覧です（同じノート・同じ日の分は 1 行にまとまります）。この履歴は Gemini には送られません。 %%",
  // loading screen (ui/loading-tips.ts)
  loadingTips: [
    "天使は、ノートの中の具体的なことを必ず1つ見つけて褒めます。",
    "悪魔は毎ターン、本当に鋭い指摘を1つだけ混ぜてきます。聞き逃さないように。",
    "ノートの一部を選択してから始めると、その部分だけについて掛け合います。",
    "「ノート末尾に保存する」で残した掛け合いには、次回から反応しません。",
    "読み上げの速度は、設定で日本語と、英語・その他の言語とで別々に変えられます。",
    "同じ掛け合いをもう一度再生しても、Gemini は呼ばれません（料金もかかりません）。",
    "天使と悪魔の声は、30 種類の中から選べます。",
    "暴飲暴食の日記には、天使はまず全肯定してから、そっとひとつだけ提案します。",
    "ノートが日本語以外でも、天使と悪魔はその言語で掛け合います。",
  ] as readonly string[],
};

export type Strings = typeof ja;

const en: Strings = {
  pluginName: "Angel & Devil",
  angel: "Angel",
  devil: "Devil",
  commandStart: "Start banter",
  actionTitle: "Angel & Devil banter",
  thinking: "Reading your note…",
  speaking: "Speaking",
  standby: "Standby",
  skip: "Skip",
  again: "Again",
  save: "Save to end of note",
  saved: "Saved",
  retry: "Retry",
  openSettings: "Open settings",
  close: "Close",
  truncated: "The note is long, so only the beginning was read.",
  savedNotice: "Saved to the note.",
  sourceMissing: "The original note could not be found, so nothing was saved.",
  noNote: "Open a Markdown note first.",
  tooShort: "The note is too short. Write a little more and try again.",
  noKey: "No Gemini API key is set. Enter one in the plugin settings.",
  err_invalid_key: "The API key looks invalid. Please check the settings.",
  err_model_not_found: "The model was not found. Please check the model name in the settings.",
  err_quota: "Usage limit reached. Please wait a moment and try again.",
  err_server: "Could not reach Gemini.",
  err_network: "Could not reach Gemini. Please check your connection.",
  err_timeout: "Gemini did not respond in time.",
  err_blocked: "The content was blocked by the safety filter. Try selecting just part of the note.",
  err_bad_output: "Could not create the banter.",
  err_unknown: "An unexpected error occurred.",
  setApiKey: "Gemini API key",
  setApiKeyDesc: "Your note is sent only when you start a banter",
  setApiKeyStoredSecret: "Stored in Obsidian's secret storage",
  setApiKeyStoredPlain: "Stored in plain text in data.json (take care when syncing or sharing the vault)",
  setGetKey: "Get a key from Google AI Studio",
  setApiKeySaved: (hint: string) => (hint ? `✓ A key is saved (ends in ••••${hint}).` : "✓ A key is saved."),
  setApiKeyNotSaved: "No key saved yet.",
  setApiKeyPlaceholderReplace: "Enter a new key only to replace it",
  setApiKeySave: "Save",
  setApiKeyDelete: "Delete",
  setApiKeyEmpty: "Enter a key before saving.",
  setApiKeySavedNotice: "API key saved.",
  setApiKeyDeletedNotice: "API key deleted.",
  setCheckKey: "Check key",
  setCheckOk: "The key works.",
  setModel: "Text model",
  setModelDesc: "Gemini model used to write the banter.",
  setLanguage: "Language",
  setLanguageDesc:
    "Language of the banter and of everything a launch shows (loading screen, buttons, notices, the read-aloud confirmation) and of the memory files. With \"Match the note\", the banter follows the note and the screens follow Obsidian. This settings tab and the command names always follow Obsidian.",
  setLanguageAuto: "Match the note",
  setRounds: "Exchanges",
  setRoundsAuto: "Auto",
  setRounds2: "2 exchanges",
  setRounds3: "3 exchanges",
  setAnimation: "Animation",
  setAnimationDesc: "Always off when the OS asks to reduce motion.",
  setSpeed: "Bubble speed",
  setSpeedSlow: "Slow",
  setSpeedNormal: "Normal",
  setSpeedFast: "Fast",
  setHeading: "Heading when saving",
  setHeadingDesc: "{{date}} and {{time}} become the date and time, {{title}} the plugin name in the banter's language. Leave empty to save without a heading.",
  setRibbon: "Show ribbon icon",
  setStatusBar: "Show status bar button (desktop only)",
  setMaxChars: "Maximum characters to read",
  setMaxCharsDesc: "Longer notes are cut to their beginning.",
  speak: "🔊 Read aloud",
  speakLoading: "Preparing audio…",
  speakStop: "■ Stop",
  speakAgain: "🔊 Play again",
  cancel: "Cancel",
  ttsConfirmTitle: "Read aloud with Gemini TTS",
  ttsConfirmBody: (model: string, turns: string) =>
    `This calls Gemini TTS (model: ${model}, ${turns} turns) to create audio. Your Google account may be charged. Continue?`,
  ttsOff: "Read aloud is turned off. Enable it in the plugin settings.",
  commandStartVoice: "Start banter with voice",
  actionTitleVoice: "Angel & Devil banter with voice",
  stepWrite: "The Angel and the Devil are writing their banter",
  stepVoice: "Recording their voices",
  tipLabel: "Tip",
  ttsConfirmOk: "Read aloud",
  ttsConfirmDontAsk: "Don't ask again (turn \"Confirm every time\" back on in the settings)",
  setTtsHeading: "Read aloud (Gemini TTS)",
  setTtsEnabled: "Enable read aloud",
  setTtsEnabledDesc: "Adds a Read aloud button to the banter. Audio generation can cost more than text.",
  setTtsModel: "TTS model",
  setTtsConfirm: "Confirm every time",
  setTtsConfirmDesc: "When off, Gemini TTS is called without asking (replaying the same banter uses the cache and costs nothing).",
  setTtsAutoplay: "Read aloud automatically",
  setTtsAutoplayDesc: "Starts reading when the banter appears. You are still asked first while Confirm every time is on.",
  setTtsSpeedJa: "Playback speed (Japanese)",
  setTtsSpeedEn: "Playback speed (English and other languages)",
  setTtsVoiceAngel: "Angel's voice",
  setTtsVoiceDevil: "Devil's voice",
  setTtsStyleAngel: "Angel's speaking style",
  setTtsStyleDevil: "Devil's speaking style",
  setTtsStyleDesc: "English works best (e.g. warm, bright, polite).",
  setMemoryHeading: "Memory",
  setMemoryEnabled: "Remember banters",
  setMemoryEnabledDesc:
    "After every banter (no need to save it), both characters leave a memo and rewrite their overall impression of you. Later banters build on the impression and the latest memos, so the pair does not keep repeating the same point. Memos are kept apart for diary notes and for other notes (articles, book notes, …), and a banter uses the memos of its own kind; the impression is one, built from both. Diary notes are those that match the folder and date format of the core Daily notes plugin (or, if Daily notes is not set up, notes whose file name starts with a date such as 2026-11-12). For a single note, set the property angel-and-devil-kind to diary or content. Another banter on the same note on the same day replaces that day's entries. All are ordinary notes in a vault folder, so you can read, edit, or delete them. While this is on, the memos and impressions are sent to the Gemini API together with your note.",
  setMemoryFolder: "Memory folder",
  setMemoryFolderDesc:
    "Folder for history.md and each character's memos (angel_memo_diary.md / angel_memo_content.md and so on) and impressions (angel_impression.md and so on). Folders starting with \".\" cannot be used because Obsidian hides them.",
  setMemoryFolderInvalid: "This folder name cannot be used. Names starting with \".\" or containing * \" < > : | ? are not allowed.",
  memoryWriteFailed: "The memory could not be written.",
  memoryUsed: (n: number) => `Also drawing on ${n} earlier ${n === 1 ? "memo" : "memos"}.`,
  // reply
  you: "You",
  replyPlaceholder: "Say something back…",
  replySend: "Send",
  replyLabel: "Reply to the banter",
  replySavedNotice: "Your reply was saved to the note too.",
  replyResaveAppended: "The saved banter could not be found, so the banter with your reply was added at the end of the note.",
  setReply: "Show the reply box",
  setReplyDesc:
    "Shows a box at the end of the banter for one short reply. The Devil and the Angel then answer with one exchange (once per banter; one more text generation).",
  memoTitle: (emoji: string, name: string, kind: NoteKind) =>
    `# ${emoji} ${name}'s memos (${kind === "diary" ? "diary" : "content"})`,
  memoNote: (max: number, kind: NoteKind) =>
    `%% Angel & Devil memory. A memo is added at the bottom after every banter on ${kind === "diary" ? "a diary note" : "a note that is not a diary entry (an article, book note, …)"} (replacing the same note's memo from the same day); only the latest ${max} are kept. Edit or delete them freely. %%`,
  impressionTitle: (emoji: string, name: string) => `# ${emoji} You, as ${name} sees you`,
  impressionNote: (max: number) =>
    `%% Angel & Devil memory. After every banter, a version rewritten from the previous impression and today's note is added at the bottom (replacing the same note's version from the same day); only the latest ${max} are kept. The next banter uses the bottom one. Edit it freely. %%`,
  historyTitle: "# 😇😈 Banter history",
  historyNote: "%% A list of banters (one line per note and day). This history is never sent to Gemini. %%",
  loadingTips: [
    "The Angel always finds one concrete thing in your note to praise.",
    "Every Devil turn hides exactly one genuinely sharp point. Listen closely.",
    "Select part of a note before starting to banter about just that part.",
    "Banter you saved with “Save to end of note” is ignored next time.",
    "Playback speed can be set separately for Japanese and for English and other languages.",
    "Replaying the same banter does not call Gemini again (and costs nothing).",
    "You can pick the Angel’s and the Devil’s voices from 30 options.",
    "For a night of junk food, the Angel affirms first, then offers just one gentle nudge.",
    "Whatever language your note is in, the Angel and the Devil banter in it too.",
  ],
};

const STRINGS: Record<string, Strings> = {
  ja,
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  fr,
  es,
  de,
};

function detectUiLang(): Lang {
  try {
    return uiLanguageFor(getLanguage());
  } catch {
    return "en";
  }
}

/** Obsidian's UI language mapped to a supported code. */
export const uiLang: Lang = detectUiLang();

export function stringsFor(lang: Lang): Strings {
  return STRINGS[lang] ?? en;
}

/**
 * Language of everything a launch shows: the banter modal, loading tips, notices, the TTS confirm and the
 * memory files. It is the plugin's language setting; with "auto" (match the note) the note's language is only
 * known after generation, so the screens stay in Obsidian's language while the banter follows the note.
 */
export function runtimeLanguage(setting: "auto" | Lang): Lang {
  return setting === "auto" ? uiLang : setting;
}

/**
 * Strings in Obsidian's UI language: for what Obsidian itself shows (settings tab, command names,
 * ribbon / header / status bar tooltips). Everything a launch shows uses `stringsFor(runtimeLanguage(...))`.
 */
export const t: Strings = stringsFor(uiLang);
