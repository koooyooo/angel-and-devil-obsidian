import type { App } from "obsidian";
import type { SecretStore, SettingsStore } from "../../ports";

const SECRET_ID = "angel-and-devil-gemini-api-key";

interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

/**
 * API key storage (design doc §5.3): Obsidian's SecretStorage when the app has it (1.11.4+),
 * the plain `apiKey` setting in data.json otherwise.
 */
export class ObsidianSecretStore implements SecretStore {
  constructor(
    private readonly app: App,
    private readonly settings: SettingsStore,
  ) {}

  private get secrets(): SecretStorageLike | undefined {
    const s = (this.app as App & { secretStorage?: SecretStorageLike }).secretStorage;
    return s && typeof s.getSecret === "function" ? s : undefined;
  }

  get secure(): boolean {
    return this.secrets !== undefined;
  }

  /**
   * Moves a plaintext key left in data.json (saved on an Obsidian without SecretStorage) into
   * SecretStorage and clears it from data.json. Runs on every load; a no-op once migrated.
   */
  async migrate(): Promise<void> {
    const secrets = this.secrets;
    const settings = this.settings.get();
    const plain = settings.apiKey;
    if (!secrets || !plain) return;
    // A key already in SecretStorage wins: it was entered later than the plaintext one.
    if (!secrets.getSecret(SECRET_ID)) secrets.setSecret(SECRET_ID, plain);
    settings.apiKey = "";
    await this.settings.save();
  }

  get(): string {
    const secrets = this.secrets;
    if (secrets) return secrets.getSecret(SECRET_ID) ?? "";
    return this.settings.get().apiKey;
  }

  async set(value: string): Promise<void> {
    const secrets = this.secrets;
    const settings = this.settings.get();
    if (secrets) {
      secrets.setSecret(SECRET_ID, value);
      // Never keep a plaintext copy once the secret store is available.
      if (settings.apiKey) {
        settings.apiKey = "";
        await this.settings.save();
      }
      return;
    }
    settings.apiKey = value;
    await this.settings.save();
  }

  /** SecretStorage has no delete; an empty value means "not set". */
  async clear(): Promise<void> {
    await this.set("");
  }
}
