# Gemini API キー

[English](api-key.md) · [README に戻る](../README_ja.md)

本プラグインは、**ご自身の API キー** を使って Gemini API を呼び出します。このページでは、キーの保存場所、それが安全性にとって何を意味するか、漏洩したときに被害を抑える方法を説明します。

## キーの保存場所

- **Obsidian 1.11.4 以降**: Obsidian の **SecretStorage** に保存されます。
- **それより古い Obsidian**: プラグインの `data.json`（`<vault>/.obsidian/plugins/angel-and-devil/data.json`）に平文で保存されます。Vault を同期・共有する際はご注意ください。

### SecretStorage は Obsidian の機能です（本プラグイン独自の仕組みではありません）

SecretStorage は、API キーなどのシークレットを保存するために **Obsidian 本体** がすべてのプラグインへ提供している標準の API です（[API リファレンス](https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage)）。本プラグインが独自に暗号化やキーの保管庫を実装しているわけではなく、API キーを扱う他のプラグインと同じように、Obsidian にキーの保管を任せています。シークレットがどのように保護されるかは Obsidian 側の仕様によります。

SecretStorage でできること・できないこと:

- キーを **Vault のファイルの外** に保管します。そのため `data.json` と違い、Vault の同期・バックアップ・共有にキーが含まれません。
- 他のプラグインからキーを **隠すことはできません**。インストール済みのプラグインは SecretStorage のシークレットを読み取れます（API には `listSecrets()` もあります）。また Obsidian のプラグイン同士はサンドボックスで隔離されておらず、他のプラグインの設定も読み取れます。**信頼できるプラグインのみをインストールしてください。**

## 本プラグインでのキーの扱い

- キーの送信先は Gemini API（`generativelanguage.googleapis.com`）だけです。送信するのは、掛け合いの開始・音声読み上げ・**キーを確認** を行ったときだけです。
- 設定画面では保存済みの API キー全体を再表示することはありません（末尾 4 文字のみ表示）。新しいキーを入力すると上書きされ、**削除** で消去できます。
- キーをログ・エラーメッセージ・通知に出すことはありません。
- 古い Obsidian で `data.json` に残った平文の API キーは、SecretStorage 対応版の Obsidian で読み込んだ際に自動的に SecretStorage へ移行され、`data.json` からは消去されます。

## API キー管理の推奨事項

- 本プラグイン用に **専用の API キー** を作成してください。
- Google Cloud Console の [認証情報](https://console.cloud.google.com/apis/credentials) で、API キーの制限を **Generative Language API** のみに絞ってください。
- 利用額の上限と通知を設定しておくことを推奨します。
  - **月の利用上限（Spend cap）**: [Google AI Studio → Spend](https://aistudio.google.com/spend) の「Edit spend cap」で設定します。上限に達するとリクエストが止まります。請求データの反映が 10 分ほど遅れることがあるため、一時的に上限を少し超える場合があります。
  - **予算アラート**: [Cloud Billing → 予算とアラート](https://console.cloud.google.com/billing/budgets) で、設定したしきい値を超えたときにメールで通知されます。
  - **利用状況とレート制限**: [Google AI Studio → Usage](https://aistudio.google.com/usage) で確認できます。
- 万が一キーが漏洩したと思われる場合は、キーを削除して再発行してください。

## 責任について

API キーの管理は利用者の責任です。キーは利用者の環境に保存され、他のプラグインや Vault の同期・共有を通じて漏れる可能性があります。キーの漏洩や不正利用によって生じた損害・料金について、作者は責任を負いません（README の [免責事項](../README_ja.md#免責事項) を参照）。
