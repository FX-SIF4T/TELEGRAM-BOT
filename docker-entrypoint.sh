#!/bin/sh
set -eu
umask 077

SETTINGS_PATH="/app/settings.json"
SETTINGS_SOURCE="${SETTINGS_FILE:-/etc/secrets/settings.json}"

if [ ! -s "$SETTINGS_PATH" ]; then
  if [ -r "$SETTINGS_SOURCE" ]; then
    cp "$SETTINGS_SOURCE" "$SETTINGS_PATH"
  elif [ -n "${SETTINGS_JSON:-}" ]; then
    printf '%s' "$SETTINGS_JSON" > "$SETTINGS_PATH"
  elif [ -n "${SETTINGS_JSON_BASE64:-}" ]; then
    printf '%s' "$SETTINGS_JSON_BASE64" | base64 -d > "$SETTINGS_PATH"
  else
    echo "Missing runtime settings. Mount settings.json or set SETTINGS_JSON." >&2
    exit 1
  fi
fi

if ! node --input-type=commonjs -e \
  'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' \
  "$SETTINGS_PATH"; then
  echo "Runtime settings file is not valid JSON." >&2
  exit 1
fi

exec "$@"
