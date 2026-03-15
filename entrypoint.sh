#!/bin/sh
set -e

export HOME=/data
CONFIG_PATH="/data/.openclaw/openclaw.json"

if [ -f "$CONFIG_PATH" ]; then
  echo "Configuration found. Starting OpenClaw gateway..."
  export OPENCLAW_CONFIG="$CONFIG_PATH"
  exec openclaw gateway start
else
  echo "No configuration found. Starting setup wizard on port 3000..."
  exec node /wizard/server.js
fi
