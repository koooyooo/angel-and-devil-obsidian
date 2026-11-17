/**
 * Vault-relative path normalization, matching Obsidian's `normalizePath`: backslashes become slashes,
 * repeated slashes collapse, leading and trailing slashes go, non-breaking spaces become spaces, and the
 * result is NFC. An empty result is "/" (the vault root), as in Obsidian.
 */
export function normalizeVaultPath(path: string): string {
  let p = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  if (p === "") p = "/";
  return p.replace(/[  ]/g, " ").normalize("NFC");
}
