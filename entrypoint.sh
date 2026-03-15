#!/bin/sh
set -e

# All openclaw state goes to /data — never touches host system
export HOME=/data
export OPENCLAW_CONFIG=/data/.openclaw/openclaw.json

mkdir -p /data/.openclaw /data/.openclaw/workspace

exec node /wizard/server.js
