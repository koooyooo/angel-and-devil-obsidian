import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ObsidianSecretStore } from "../src/platform/obsidian/secrets";
import { apiKeyHint, hasApiKey, mergeSettings } from "../src/settings-model";
import { FakeSettingsStore } from "./fakes/settings";

class FakeSecrets {
  readonly store = new Map<string, string>();
  getSecret(id: string): string | null {
    return this.store.has(id) ? this.store.get(id)! : null;
  }
  setSecret(id: string, secret: string): void {
    this.store.set(id, secret);
  }
}

function setup(options: { secrets: boolean; plainKey?: string }) {
  const secrets = options.secrets ? new FakeSecrets() : undefined;
  const app = (secrets ? { secretStorage: secrets } : {}) as unknown as App;
  const settings = new FakeSettingsStore({ apiKey: options.plainKey ?? "" });
  const store = new ObsidianSecretStore(app, settings);
  return { store, settings, secrets, saves: () => settings.saves };
}

const KEY = "AIzaSyExample-1234567890abcd";

describe("ApiKeyStore with SecretStorage", () => {
  it("stores the key only in SecretStorage", async () => {
    const { store, settings, secrets } = setup({ secrets: true });
    await store.set(KEY);
    expect(store.get()).toBe(KEY);
    expect(settings.settings.apiKey).toBe("");
    expect([...secrets!.store.values()]).toEqual([KEY]);
  });

  it("migrates a plaintext key from data.json and clears it", async () => {
    const { store, settings, secrets, saves } = setup({ secrets: true, plainKey: KEY });
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(settings.settings.apiKey).toBe("");
    expect(secrets!.store.size).toBe(1);
    expect(saves()).toBe(1);
  });

  it("keeps an existing secret over an older plaintext key", async () => {
    const { store, settings, secrets } = setup({ secrets: true, plainKey: "old-plaintext-key-0000" });
    secrets!.setSecret("angel-and-devil-gemini-api-key", KEY);
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(settings.settings.apiKey).toBe("");
  });

  it("does nothing when there is no plaintext key", async () => {
    const { store, saves } = setup({ secrets: true });
    await store.migrate();
    expect(saves()).toBe(0);
    expect(hasApiKey(store.get())).toBe(false);
  });

  it("never falls back to data.json once SecretStorage exists", () => {
    const { store } = setup({ secrets: true, plainKey: KEY }); // not migrated yet
    expect(store.get()).toBe("");
  });

  it("clears the key", async () => {
    const { store } = setup({ secrets: true });
    await store.set(KEY);
    await store.clear();
    expect(hasApiKey(store.get())).toBe(false);
  });
});

describe("ApiKeyStore without SecretStorage (Obsidian < 1.11.4)", () => {
  it("falls back to data.json and does not migrate", async () => {
    const { store, settings } = setup({ secrets: false, plainKey: KEY });
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(settings.settings.apiKey).toBe(KEY);
    await store.set("another-key-9999999999");
    expect(settings.settings.apiKey).toBe("another-key-9999999999");
  });

  it("coerces a non-string apiKey in data.json to an empty string", () => {
    const merged = mergeSettings({ apiKey: 12345 as unknown as string });
    expect(merged.apiKey).toBe("");
    const mergedNull = mergeSettings({ apiKey: null as unknown as string });
    expect(mergedNull.apiKey).toBe("");
  });
});

describe("ObsidianSecretStore.secure", () => {
  it("is true only with SecretStorage", () => {
    expect(setup({ secrets: true }).store.secure).toBe(true);
    expect(setup({ secrets: false }).store.secure).toBe(false);
  });
});

describe("apiKeyHint", () => {
  it("shows only the last four characters", () => {
    expect(apiKeyHint(KEY)).toBe("abcd");
    expect(apiKeyHint(` ${KEY} `)).toBe("abcd");
  });
  it("shows nothing for very short values", () => {
    expect(apiKeyHint("short")).toBe("");
  });
});

describe("hasApiKey", () => {
  it("ignores whitespace", () => {
    expect(hasApiKey("  ")).toBe(false);
    expect(hasApiKey(KEY)).toBe(true);
  });
});
