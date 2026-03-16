#!/bin/sh
set -e

# All openclaw state goes to /data — never touches host system
export HOME=/data
export OPENCLAW_CONFIG=/data/.openclaw/openclaw.json

mkdir -p /data/.openclaw /data/.openclaw/workspace

# Copy bundled skills to workspace (if not already present)
if [ -d /opt/skills ] && [ ! -d /data/.openclaw/workspace/skills/openviking ]; then
  mkdir -p /data/.openclaw/workspace/skills
  cp -r /opt/skills/* /data/.openclaw/workspace/skills/ 2>/dev/null || true
  echo "[rayaclaw] Bundled skills copied to workspace"
fi

# Configure rtk for Claude Code agents (reduces LLM token usage 60-90%)
if [ "${RTK_ENABLED:-true}" = "true" ] && command -v rtk >/dev/null 2>&1; then
  rtk init --global --auto-patch 2>/dev/null || true
fi

# ── RayaClaw Internal Services (LiteLLM + OpenViking) ────────────────────────
# Fully isolated inside container — no external dependencies
# LiteLLM: OpenAI-compatible proxy using the Claude token from wizard setup
# OpenViking: Knowledge base MCP server using LiteLLM for VLM + local embedding

AUTH_PROFILES="/data/.openclaw/agents/main/agent/auth-profiles.json"
LITELLM_CONFIG="/data/litellm-config.yaml"
OV_CONF="/data/ov.conf"
OV_DATA="/data/.openviking"

# Persist fastembed model cache across container restarts
export FASTEMBED_CACHE_PATH="/data/.fastembed"

start_litellm() {
  echo "[rayaclaw] Extracting Claude key from auth-profiles.json..."
  CLAUDE_KEY=""
  if [ -f "$AUTH_PROFILES" ]; then
    CLAUDE_KEY=$(python3 -c "
import json
try:
    d = json.load(open('$AUTH_PROFILES'))
    p = d.get('profiles', {}).get('anthropic:default', {})
    print(p.get('key') or p.get('token') or '')
except:
    pass
" 2>/dev/null || true)
  fi

  if [ -z "$CLAUDE_KEY" ]; then
    echo "[rayaclaw] No Claude key found yet — LiteLLM will start without Claude model"
    echo "[rayaclaw] (Key will be picked up after wizard setup + restart)"
  fi

  # Generate LiteLLM config dynamically
  python3 << PYEOF > "$LITELLM_CONFIG"
claude_key = """$CLAUDE_KEY""".strip()
lines = ["model_list:"]
if claude_key:
    lines += [
        "  - model_name: claude-sonnet",
        "    litellm_params:",
        "      model: anthropic/claude-sonnet-4-6",
        f'      api_key: "{claude_key}"',
    ]
lines += [
    "  - model_name: text-embedding-3-small",
    "    litellm_params:",
    '      model: "fastembed/BAAI/bge-small-en-v1.5"',
    "general_settings:",
    "  master_key: rayaclaw-local-key",
]
print("\\n".join(lines))
PYEOF

  echo "[rayaclaw] Starting LiteLLM proxy on :10624..."
  litellm --config "$LITELLM_CONFIG" --port 10624 --host 127.0.0.1 \
    > /data/litellm.log 2>&1 &
  LITELLM_PID=$!

  # Wait for LiteLLM health (max 30s)
  for i in $(seq 1 30); do
    if curl -sf -H "Authorization: Bearer rayaclaw-local-key" http://localhost:10624/health > /dev/null 2>&1; then
      echo "[rayaclaw] LiteLLM ready (PID $LITELLM_PID)"
      return 0
    fi
    sleep 1
  done
  echo "[rayaclaw] WARNING: LiteLLM did not become ready in 30s (check /data/litellm.log)"
  return 1
}

start_openviking() {
  mkdir -p "$OV_DATA"

  # Generate ov.conf
  cat > "$OV_CONF" << 'OVCONF'
{
  "embedding": {
    "dense": {
      "api_base": "http://localhost:10624/v1",
      "api_key": "rayaclaw-local-key",
      "provider": "openai",
      "dimension": 384,
      "model": "text-embedding-3-small"
    }
  },
  "vlm": {
    "api_base": "http://localhost:10624/v1",
    "api_key": "rayaclaw-local-key",
    "provider": "openai",
    "model": "claude-sonnet"
  }
}
OVCONF

  OV_SERVER="/opt/openviking/examples/mcp-query/server.py"
  if [ ! -f "$OV_SERVER" ]; then
    echo "[rayaclaw] WARNING: OpenViking server.py not found — skipping"
    return 1
  fi

  echo "[rayaclaw] Starting OpenViking MCP server on :2033..."
  cd /opt/openviking/examples && \
  python3 "$OV_SERVER" \
    --config "$OV_CONF" \
    --data "$OV_DATA" \
    --port 2033 \
    > /data/openviking.log 2>&1 &
  OV_PID=$!

  # Wait for OpenViking health (max 30s)
  for i in $(seq 1 30); do
    # MCP uses SSE — check with Accept header; 406 still means server is up
    RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:2033/mcp 2>/dev/null || echo "000")
    if [ "$RESP" = "200" ] || [ "$RESP" = "406" ]; then
      echo "[rayaclaw] OpenViking ready (PID $OV_PID)"
      return 0
    fi
    sleep 1
  done
  echo "[rayaclaw] WARNING: OpenViking did not become ready in 30s (check /data/openviking.log)"
  return 1
}

seed_knowledge() {
  SEED_FLAG="/data/.openviking-seeded"
  DOCS_DIR=""
  # Find openclaw docs directory
  for d in /usr/local/lib/node_modules/openclaw/docs /usr/lib/node_modules/openclaw/docs; do
    if [ -d "$d" ]; then DOCS_DIR="$d"; break; fi
  done

  if [ -f "$SEED_FLAG" ]; then
    echo "[rayaclaw] Knowledge base already seeded — skipping"
    return 0
  fi

  if [ -z "$DOCS_DIR" ]; then
    echo "[rayaclaw] WARNING: OpenClaw docs not found — skipping seed"
    return 1
  fi

  echo "[rayaclaw] Seeding knowledge base from $DOCS_DIR..."
  /opt/seed-knowledge.sh "$DOCS_DIR" && touch "$SEED_FLAG" \
    && echo "[rayaclaw] Knowledge base seeded successfully" \
    || echo "[rayaclaw] WARNING: Knowledge base seeding failed (non-fatal)"
}

# Start internal services (graceful — never block wizard startup)
echo "[rayaclaw] Initializing internal services..."
if start_litellm; then
  if start_openviking; then
    # Seed in background so it doesn't delay wizard
    seed_knowledge &
  fi
fi
echo "[rayaclaw] Internal services initialized"

exec node /wizard/server.js
