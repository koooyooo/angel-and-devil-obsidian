# Gemini API key

[日本語](api-key_ja.md) · [Back to README](../README.md)

This plugin calls the Gemini API with **your own API key**. This page explains where the key is stored, what that means for its safety, and how to limit the damage if it leaks.

## Where the key is stored

- **Obsidian 1.11.4 and later**: in Obsidian's **SecretStorage**.
- **Older Obsidian**: in plain text in this plugin's `data.json` (`<vault>/.obsidian/plugins/angel-and-devil/data.json`). Take care when syncing or sharing your vault.

### SecretStorage is an Obsidian feature, not this plugin's

SecretStorage is a standard API that **Obsidian itself** provides to every plugin for saving secrets such as API keys ([API reference](https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage)). This plugin does not implement its own encryption or key store; it asks Obsidian to keep the key, the same way other plugins that need API keys do. How the secret is protected is up to Obsidian.

What SecretStorage does and does not do:

- It keeps the key **out of your vault files**, so the key does not travel with vault sync, backups, or a shared vault the way `data.json` would.
- It does **not** hide the key from other plugins. Any installed plugin can read secrets in SecretStorage (the API even has `listSecrets()`). Obsidian plugins are not sandboxed from each other, so a plugin can also read other plugins' settings. **Only install plugins you trust.**

## How the plugin handles the key

- The key is sent only to the Gemini API (`generativelanguage.googleapis.com`), and only when you start a banter, use read aloud, or press **Check key**.
- The settings tab never shows the saved key again (only its last four characters). Enter a new key only to replace it; **Delete** removes it.
- The key is never written to logs, error messages, or notices.
- A plaintext key left in `data.json` by an older Obsidian is moved into SecretStorage automatically on load once your Obsidian supports it, and removed from `data.json`.

## Recommended key hygiene

- Create a **dedicated** API key for this plugin.
- In Google Cloud Console, restrict the key to the **Generative Language API** ([Credentials](https://console.cloud.google.com/apis/credentials)).
- Cap and watch your spending:
  - **Monthly spend cap**: [Google AI Studio → Spend](https://aistudio.google.com/spend) (“Edit spend cap”). Requests pause once the cap is reached. Billing data can lag by about 10 minutes, so spending can briefly go over it.
  - **Budget alert**: [Cloud Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets) sends email when spending crosses the thresholds you set.
  - **Usage and rate limits**: [Google AI Studio → Usage](https://aistudio.google.com/usage).
- If you think the key leaked, delete it and create a new one.

## Responsibility

Keeping your API key safe is your responsibility. The key is stored on your device and can be exposed through other plugins or vault sync and sharing. The author is not liable for any damages or charges caused by a leaked or misused key (see [Disclaimer](../README.md#disclaimer) in the README).
