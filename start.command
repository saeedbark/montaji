#!/bin/sh
# macOS: double-click this file in Finder to start Montaji.
# It opens a Terminal window; keep it open while you use the editor, close it to stop.
cd "$(dirname "$0")" || exit 1
sh ./start.sh
status=$?
if [ $status -ne 0 ]; then
  printf '\n  Press Enter to close this window.'
  read -r _
fi
exit $status
