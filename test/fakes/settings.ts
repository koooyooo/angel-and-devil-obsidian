import type { SecretStore, SettingsStore } from "../../src/ports";
import { type AadSettings, mergeSettings } from "../../src/settings-model";

/** SettingsStore over an in-memory object; counts saves. */
export class FakeSettingsStore implements SettingsStore {
  readonly settings: AadSettings;
  saves = 0;

  constructor(saved: unknown = {}) {
    this.settings = mergeSettings(saved);
  }

  get(): AadSettings {
    return this.settings;
  }

  async save(): Promise<void> {
    this.saves++;
  }
}

/** SecretStore holding the key in memory. */
export class FakeSecretStore implements SecretStore {
  readonly secure = true;
  constructor(private key = "") {}
  get(): string {
    return this.key;
  }
  async set(value: string): Promise<void> {
    this.key = value;
  }
  async clear(): Promise<void> {
    this.key = "";
  }
}
