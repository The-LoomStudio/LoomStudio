#!/bin/sh
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1
./start.sh
status=$?
if [ "$status" -ne 0 ]; then
  printf '%s' 'Startup failed. Press Enter to close.'
  read -r answer
fi
exit "$status"
