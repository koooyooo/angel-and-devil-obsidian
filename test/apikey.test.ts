import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type AngelDevilPlugin from "../src/main";
import { ApiKeyStore, DEFAULT_SETTINGS, mergeSettings } from "../src/settings";

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
  let saves = 0;
  const plugin = {
    settings: mergeSettings({ ...DEFAULT_SETTINGS, apiKey: options.plainKey ?? "" }),
    saveSettings: async () => {
      saves++;
    },
  } as unknown as AngelDevilPlugin;
  return { store: new ApiKeyStore(app, plugin), plugin, secrets, saves: () => saves };
}

const KEY = "AIzaSyExample-1234567890abcd";

describe("ApiKeyStore with SecretStorage", () => {
  it("stores the key only in SecretStorage", async () => {
    const { store, plugin, secrets } = setup({ secrets: true });
    await store.set(KEY);
    expect(store.get()).toBe(KEY);
    expect(plugin.settings.apiKey).toBe("");
    expect([...secrets!.store.values()]).toEqual([KEY]);
  });

  it("migrates a plaintext key from data.json and clears it", async () => {
    const { store, plugin, secrets, saves } = setup({ secrets: true, plainKey: KEY });
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(plugin.settings.apiKey).toBe("");
    expect(secrets!.store.size).toBe(1);
    expect(saves()).toBe(1);
  });

  it("keeps an existing secret over an older plaintext key", async () => {
    const { store, plugin, secrets } = setup({ secrets: true, plainKey: "old-plaintext-key-0000" });
    secrets!.setSecret("angel-and-devil-gemini-api-key", KEY);
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(plugin.settings.apiKey).toBe("");
  });

  it("does nothing when there is no plaintext key", async () => {
    const { store, saves } = setup({ secrets: true });
    await store.migrate();
    expect(saves()).toBe(0);
    expect(store.has()).toBe(false);
  });

  it("never falls back to data.json once SecretStorage exists", () => {
    const { store } = setup({ secrets: true, plainKey: KEY }); // not migrated yet
    expect(store.get()).toBe("");
  });

  it("clears the key", async () => {
    const { store } = setup({ secrets: true });
    await store.set(KEY);
    await store.clear();
    expect(store.has()).toBe(false);
  });
});

describe("ApiKeyStore without SecretStorage (Obsidian < 1.11.4)", () => {
  it("falls back to data.json and does not migrate", async () => {
    const { store, plugin } = setup({ secrets: false, plainKey: KEY });
    await store.migrate();
    expect(store.get()).toBe(KEY);
    expect(plugin.settings.apiKey).toBe(KEY);
    await store.set("another-key-9999999999");
    expect(plugin.settings.apiKey).toBe("another-key-9999999999");
  });
});

describe("hint", () => {
  it("shows only the last four characters", async () => {
    const { store } = setup({ secrets: true });
    await store.set(KEY);
    expect(store.hint()).toBe("abcd");
  });
  it("shows nothing for very short values", async () => {
    const { store } = setup({ secrets: true });
    await store.set("short");
    expect(store.hint()).toBe("");
  });
});
