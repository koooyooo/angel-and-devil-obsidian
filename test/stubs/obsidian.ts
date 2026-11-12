// Minimal stand-in for the `obsidian` module so pure modules can be imported in Node tests.
export function getLanguage(): string {
  return "en";
}
export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests");
}
export class Notice {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
export const Platform = { isMobile: false };
