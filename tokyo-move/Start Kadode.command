#!/bin/bash
# Double-click in Finder to start Kadode on this Mac. A Terminal window opens and the browser follows.
# Leave the window open while you use Kadode; close it (or press Ctrl-C) to stop.
cd "$(dirname "$0")" || exit 1
# Homebrew's node@22 is not on the default PATH; look in the usual places too.
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Node installed with nvm, Volta or fnm is only set up by the shell's own startup files, which a double-clicked script
# does not read. Look there before giving up.
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    command -v npm >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1
  fi
fi
if ! command -v npm >/dev/null 2>&1 && [ -d "$HOME/.volta/bin" ]; then
  export PATH="$HOME/.volta/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash 2>/dev/null)"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Kadode needs Node 22, which isn't installed yet. In Terminal run:  brew install node@22"
  read -r -p "Press Return to close this window. "
  exit 1
fi
npm run preview
status=$?
if [ "$status" -ne 0 ]; then read -r -p "Press Return to close this window. "; fi
exit "$status"
