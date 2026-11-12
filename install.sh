#!/bin/sh
# Downloads the built plugin from GitHub Releases and installs it into an existing Obsidian vault.
#   usage: ./install.sh <vault-path> [version]
#   or:    curl -fsSL https://raw.githubusercontent.com/koooyooo/angel-and-devil-obsidian/main/install.sh | sh -s -- <vault-path> [version]
#
# - Downloads main.js / manifest.json / styles.css into <vault>/.obsidian/plugins/angel-and-devil/.
# - Existing settings (data.json) and the vault's plugin list are left untouched.
set -eu

REPO="${AAD_GITHUB_REPO:-koooyooo/angel-and-devil-obsidian}"
PLUGIN_ID="angel-and-devil"
FILES="main.js manifest.json styles.css"

if [ $# -lt 1 ] || [ $# -gt 2 ] || [ -z "$1" ]; then
  echo "usage: $0 <vault-path> [version]" >&2
  echo "example: $0 ~/obsidian/default" >&2
  echo "example: $0 ~/obsidian/default 0.1.0" >&2
  exit 1
fi

# Expand a leading ~ if passed quoted or via sh -s.
case "$1" in
  "~") VAULT="$HOME" ;;
  "~/"*) VAULT="$HOME/${1#\~/}" ;;
  *) VAULT="$1" ;;
esac

VERSION="${2:-latest}"

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Not an Obsidian vault (no .obsidian/ folder): $VAULT" >&2
  echo "Open the folder in Obsidian once first, or check the path." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download release assets." >&2
  exit 1
fi

if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/$REPO/releases/latest/download"
else
  # Strip optional leading 'v' (tags are bare semver like 0.1.0).
  TAG="${VERSION#v}"
  BASE_URL="https://github.com/$REPO/releases/download/$TAG"
fi

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t aad-install)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "Downloading $PLUGIN_ID ($VERSION) from $REPO..."
for f in $FILES; do
  if ! curl -fsSL "$BASE_URL/$f" -o "$TMP_DIR/$f"; then
    echo "Failed to download $BASE_URL/$f" >&2
    echo "Make sure a GitHub Release exists for '$VERSION' at https://github.com/$REPO/releases" >&2
    exit 1
  fi
  if [ ! -s "$TMP_DIR/$f" ]; then
    echo "Downloaded $f is empty; aborting." >&2
    exit 1
  fi
done

INSTALLED_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TMP_DIR/manifest.json")"
DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$DEST"

for f in $FILES; do
  if [ -L "$DEST/$f" ]; then rm "$DEST/$f"; fi
  cp "$TMP_DIR/$f" "$DEST/$f"
done

echo "Installed $PLUGIN_ID ${INSTALLED_VERSION:-$VERSION} into $DEST"
if [ -f "$DEST/data.json" ]; then
  echo "Existing settings (data.json) were kept."
fi
echo "In Obsidian: Settings → Community plugins → turn off Restricted mode if needed, then enable \"Angel & Devil\"."
echo "If it was already enabled, turn it off and on again (or run \"Reload app without saving\") to load the new version."
