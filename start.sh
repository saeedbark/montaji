#!/bin/sh
# Starts the local server and opens the editor in your default browser (macOS / Linux).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download it from https://nodejs.org then run this file again."
  exit 1
fi

URL="http://localhost:${PORT:-4747}"
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

exec node server/index.js
