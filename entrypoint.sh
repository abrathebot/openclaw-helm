#!/bin/sh
set -e

# All openclaw state goes to /data — never touches host system
export HOME=/data
export OPENCLAW_CONFIG=/data/.openclaw/openclaw.json

mkdir -p /data/.openclaw /data/.openclaw/workspace

# Configure rtk for Claude Code agents (reduces LLM token usage 60-90%)
if [ "${RTK_ENABLED:-true}" = "true" ] && command -v rtk >/dev/null 2>&1; then
  rtk init --global --auto-patch 2>/dev/null || true
fi

# Export OpenViking URL so openclaw gateway can auto-configure memory plugin
if [ "${OPENVIKING_ENABLED:-false}" = "true" ] && [ -n "${OPENVIKING_URL:-}" ]; then
  export OPENCLAW_MEMORY_PROVIDER=openviking
  export OPENCLAW_MEMORY_URL="${OPENVIKING_URL}"
fi

exec node /wizard/server.js
