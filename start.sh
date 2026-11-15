#!/bin/sh
# Starts Montaji and opens the editor in your default browser (macOS / Linux).
# Keep this window open while you use the editor; close it to stop.
cd "$(dirname "$0")" || exit 1

# Node's macOS installer and Homebrew put node here; a double-clicked script may not have them on PATH
PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo "  1. Download the LTS version from https://nodejs.org and install it."
  echo "  2. Then run this file again."
  echo
  exit 1
fi

exec node server/index.js --open
