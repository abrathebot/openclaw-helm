#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  OpenClaw Deploy — one-script, any environment                  ║
# ║  Supports: Docker (default) | Helm/K8s                          ║
# ║  Auto-patches Cloudflare tunnel if present                      ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# Usage:
#   ./deploy.sh <name>                                    # interactive (name required)
#   ./deploy.sh mybot                                     # uses .env for host/token
#   ./deploy.sh raya-bot --host ai.example.com            # override host
#   ./deploy.sh mybot --cf-config ~/.cloudflared/x.yml    # existing CF config
#   ./deploy.sh mybot --mode helm                         # Helm/K8s mode
#
#   curl -fsSL https://raw.githubusercontent.com/abrathebot/openclaw-helm/master/deploy.sh | \
#     bash -s -- mybot

set -euo pipefail

# ── Load .env (priority: ./openclaw.env > ./.env > script-dir/.env) ──────────
_load_env() {
  local candidates=(
    "./openclaw.env"
    "./.env"
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env"
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/openclaw.env"
  )
  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      # shellcheck disable=SC1090
      set -a; source "$f"; set +a
      _ENV_FILE="$f"
      break
    fi
  done
}
_ENV_FILE=""
_load_env

# ── Colors ────────────────────────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; PURPLE='\033[0;35m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
info() { echo -e "${DIM}  $*${RESET}"; }
step() { echo -e "\n${BOLD}${CYAN}→ $*${RESET}"; }

# ── Defaults (infra from .env, name always from CLI) ─────────────────────────
NAME=""                                          # required: positional arg or --name
HOST="${OPENCLAW_HOST:-}"
MODE="${OPENCLAW_MODE:-docker}"                  # docker | helm
IMAGE="${OPENCLAW_IMAGE:-ghcr.io/abrathebot/openclaw:latest}"
LOCAL_IMAGE="openclaw-helm:latest"
PORT="${OPENCLAW_PORT:-}"                        # auto-detect if empty
CF_CONFIG="${CF_CONFIG:-}"                       # path to existing cloudflared config
CF_TOKEN="${CF_TUNNEL_TOKEN:-}"                  # CF tunnel token (from .env)
CF_TUNNEL_SERVICE="${CF_TUNNEL_SERVICE:-}"       # systemd user service name (auto-detect)
NAMESPACE="${OPENCLAW_NAMESPACE:-openclaw}"      # helm only
DATA_DIR="${OPENCLAW_DATA_DIR:-}"                # custom data dir (docker volume name or path)
NO_TUNNEL=false
NO_RTK=false
NO_OPENVIKING=false
YES=false

# ── Arg parse ────────────────────────────────────────────────────────────────
# First positional arg = instance name
if [[ $# -gt 0 && "${1:0:1}" != "-" ]]; then
  NAME="$1"; shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name|-n)       NAME="$2";          shift 2 ;;
    --host)          HOST="$2";          shift 2 ;;
    --mode)          MODE="$2";          shift 2 ;;
    --image)         IMAGE="$2";         shift 2 ;;
    --port|-p)       PORT="$2";          shift 2 ;;
    --cf-config)     CF_CONFIG="$2";     shift 2 ;;
    --cf-token)      CF_TOKEN="$2";      shift 2 ;;
    --namespace)     NAMESPACE="$2";     shift 2 ;;
    --data-dir)      DATA_DIR="$2";      shift 2 ;;
    --no-tunnel)     NO_TUNNEL=true;     shift ;;
    --no-rtk)        NO_RTK=true;        shift ;;
    --no-openviking) NO_OPENVIKING=true; shift ;;
    -y|--yes)        YES=true;           shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${PURPLE}${BOLD}"
cat << 'LOGO'
   ____                    ________
  / __ \____  ___  ____  / ____/ /__ __      __
 / / / / __ \/ _ \/ __ \/ /   / / __ `/ | /| / /
/ /_/ / /_/ /  __/ / / / /___/ / /_/ /| |/ |/ /
\____/ .___/\___/_/ /_/\____/_/\__,_/ |__/|__/
    /_/
LOGO
echo -e "${RESET}${BOLD}  OpenClaw Deploy Script${RESET}  ${DIM}— Docker + Cloudflare Tunnel${RESET}"
[[ -n "$_ENV_FILE" ]] && echo -e "  ${DIM}Config loaded from: ${_ENV_FILE}${RESET}"
echo ""

# ── Interactive prompts ───────────────────────────────────────────────────────
if [[ -z "$NAME" ]]; then
  read -rp "$(echo -e "${BOLD}Instance name${RESET} (e.g. raya-bot): ")" NAME
  NAME="${NAME:-openclaw}"
fi

if [[ -z "$HOST" && "$YES" = false ]]; then
  read -rp "$(echo -e "${BOLD}Public hostname${RESET} (e.g. ai.example.com, blank = port-forward only): ")" _h
  HOST="${_h:-}"

  if [[ -n "$HOST" && -z "$CF_TOKEN" && -z "$CF_CONFIG" && "$NO_TUNNEL" = false ]]; then
    read -rp "$(echo -e "${BOLD}Cloudflare tunnel token${RESET} (blank to skip): ")" _t
    CF_TOKEN="${_t:-}"
  fi
fi

DATA_DIR="${DATA_DIR:-${NAME}-data}"

# ── Detect mode ───────────────────────────────────────────────────────────────
if [[ "$MODE" = "docker" ]]; then
  if ! command -v docker &>/dev/null; then
    err "docker not found. Install Docker or use --mode helm"
    exit 1
  fi
  ok "Docker found ($(docker --version | grep -o '[0-9.]*' | head -1))"
elif [[ "$MODE" = "helm" ]]; then
  for cmd in kubectl helm; do
    if ! command -v "$cmd" &>/dev/null; then
      err "$cmd not found"; exit 1
    fi
  done
  ok "kubectl + helm found"
fi

# ── Find free port (Docker mode) ──────────────────────────────────────────────
find_free_port() {
  local start="${1:-3001}"
  local port=$start
  while ss -tlnH "sport = :${port}" 2>/dev/null | grep -q .; do
    ((port++))
  done
  echo "$port"
}

if [[ "$MODE" = "docker" && -z "$PORT" ]]; then
  PORT=$(find_free_port 3001)
  info "Auto-selected host port: ${PORT}"
fi

# ── Resolve Docker image ──────────────────────────────────────────────────────
resolve_image() {
  # Prefer local build if exists
  if docker image inspect "$LOCAL_IMAGE" &>/dev/null 2>&1; then
    echo "$LOCAL_IMAGE"
    return
  fi
  echo "$IMAGE"
}

# ── Pull/build image ──────────────────────────────────────────────────────────
if [[ "$MODE" = "docker" ]]; then
  step "Resolving Docker image"
  FINAL_IMAGE=$(resolve_image)

  if [[ "$FINAL_IMAGE" = "$LOCAL_IMAGE" ]]; then
    ok "Using local image: ${LOCAL_IMAGE}"
  else
    # Try pulling from ghcr.io
    info "Pulling ${IMAGE}..."
    if ! docker pull "$IMAGE" 2>/dev/null; then
      warn "Pull failed — trying to build from source"
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [[ -f "$SCRIPT_DIR/Dockerfile" ]]; then
        docker build -t "$LOCAL_IMAGE" "$SCRIPT_DIR"
        FINAL_IMAGE="$LOCAL_IMAGE"
        ok "Built image from source"
      else
        # Clone and build
        TMP_REPO="/tmp/openclaw-helm-build"
        rm -rf "$TMP_REPO"
        git clone --depth 1 https://github.com/abrathebot/openclaw-helm.git "$TMP_REPO"
        docker build -t "$LOCAL_IMAGE" "$TMP_REPO"
        FINAL_IMAGE="$LOCAL_IMAGE"
        ok "Built image from git"
      fi
    else
      FINAL_IMAGE="$IMAGE"
      ok "Pulled ${IMAGE}"
    fi
  fi
fi

# ── Stop existing container (if any) ─────────────────────────────────────────
if [[ "$MODE" = "docker" ]]; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
    warn "Container '${NAME}' already exists — stopping and removing"
    docker stop "$NAME" &>/dev/null || true
    docker rm   "$NAME" &>/dev/null || true
  fi
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
step "Deploying OpenClaw: ${BOLD}${NAME}${RESET}"

RTK_VAL="true";        [[ "$NO_RTK" = true ]]        && RTK_VAL="false"
OV_VAL="true";         [[ "$NO_OPENVIKING" = true ]]  && OV_VAL="false"
BASE_PATH="/${NAME}"
INGRESS_HOST="${HOST:-localhost}"

if [[ "$MODE" = "docker" ]]; then
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "${PORT}:3000" \
    -v "${DATA_DIR}:/data" \
    -e BASE_PATH="$BASE_PATH" \
    -e INGRESS_HOST="$INGRESS_HOST" \
    -e RELEASE_NAME="$NAME" \
    -e RTK_ENABLED="$RTK_VAL" \
    -e OPENVIKING_ENABLED="$OV_VAL" \
    "$FINAL_IMAGE"

  ok "Container '${NAME}' started on port ${PORT}"
  info "Data volume: ${DATA_DIR}"

elif [[ "$MODE" = "helm" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CHART_PATH="$SCRIPT_DIR"
  if [[ ! -f "$CHART_PATH/Chart.yaml" ]]; then
    CHART_PATH="/tmp/openclaw-helm"
    rm -rf "$CHART_PATH"
    git clone --depth 1 https://github.com/abrathebot/openclaw-helm.git "$CHART_PATH"
  fi

  SET_ARGS=(
    --set "ingress.host=${HOST}"
    --set "openviking.enabled=${OV_VAL}"
    --set "rtk.enabled=${RTK_VAL}"
  )

  helm upgrade --install "$NAME" "$CHART_PATH" \
    --namespace "$NAMESPACE" \
    --create-namespace \
    --wait --timeout 180s \
    "${SET_ARGS[@]}"

  ok "Helm release '${NAME}' installed in namespace '${NAMESPACE}'"
fi

# ── Cloudflare Tunnel setup ───────────────────────────────────────────────────
setup_cloudflare() {
  step "Setting up Cloudflare Tunnel"

  # ── Find or validate tunnel config ───────────────────────────────────────
  if [[ -z "$CF_CONFIG" ]]; then
    # Auto-detect: find yml files in ~/.cloudflared that have 'ingress:' and 'hostname:' with our host
    if [[ -n "$HOST" ]]; then
      CF_CONFIG=$(grep -rl "hostname: ${HOST}" ~/.cloudflared/*.yml 2>/dev/null | head -1 || true)
    fi
    # Fallback: find any tunnel config
    if [[ -z "$CF_CONFIG" ]]; then
      CF_CONFIG=$(ls ~/.cloudflared/*.yml 2>/dev/null | grep -v "cert\|credentials" | head -1 || true)
    fi
  fi

  if [[ -z "$CF_TOKEN" && -z "$CF_CONFIG" ]]; then
    warn "No Cloudflare tunnel config found. Skipping tunnel setup."
    warn "To enable: provide --cf-token <TOKEN> or --cf-config <path>"
    return 0
  fi

  # ── Zero-config: token provided ──────────────────────────────────────────
  if [[ -n "$CF_TOKEN" && -z "$CF_CONFIG" ]]; then
    # Create minimal tunnel config using token (no creds file needed)
    mkdir -p ~/.cloudflared

    # Detect any existing config with same host to append to
    EXISTING=$(grep -rl "hostname: ${HOST}" ~/.cloudflared/*.yml 2>/dev/null | head -1 || true)

    if [[ -n "$EXISTING" ]]; then
      CF_CONFIG="$EXISTING"
      info "Found existing tunnel config: ${CF_CONFIG}"
    else
      # Create new config using cloudflared tunnel token mode
      CF_CONFIG="${HOME}/.cloudflared/${NAME}.yml"
      cat > "$CF_CONFIG" << CFYML
# Generated by openclaw deploy.sh
tunnel-token: ${CF_TOKEN}

ingress:
  - hostname: ${HOST}
    service: http://localhost:${PORT}
    originRequest:
      connectTimeout: 60s
      tcpKeepAlive: 30s
      keepAliveConnections: 10
      keepAliveTimeout: 90s
  - service: http_status:404
CFYML
      ok "Created tunnel config: ${CF_CONFIG}"

      # Create systemd user service
      mkdir -p ~/.config/systemd/user
      SERVICE_NAME="openclaw-${NAME}-tunnel"
      SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
      CLOUDFLARED_BIN=$(command -v cloudflared || echo "cloudflared")

      cat > "$SERVICE_FILE" << SVCEOF
[Unit]
Description=OpenClaw ${NAME} Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${CLOUDFLARED_BIN} tunnel --config ${CF_CONFIG} run
Restart=on-failure
RestartSec=5s
MemoryMax=128M

[Install]
WantedBy=default.target
SVCEOF

      systemctl --user daemon-reload
      systemctl --user enable "$SERVICE_NAME"
      systemctl --user start  "$SERVICE_NAME"
      CF_TUNNEL_SERVICE="$SERVICE_NAME"
      ok "Tunnel service started: ${SERVICE_NAME}"
      return 0
    fi
  fi

  # ── Patch existing config: add/update path route ──────────────────────────
  if [[ -n "$CF_CONFIG" && -f "$CF_CONFIG" ]]; then
    info "Patching: ${CF_CONFIG}"

    # Check if this instance already has a route
    if grep -q "service: http://localhost:${PORT}" "$CF_CONFIG" 2>/dev/null; then
      ok "Route already present in ${CF_CONFIG}"
    else
      # Create backup
      cp "$CF_CONFIG" "${CF_CONFIG}.bak.$(date +%s)"

      # Use Python to safely patch the YAML
      python3 << PYEOF
import re, sys

with open('${CF_CONFIG}', 'r') as f:
    content = f.read()

new_rule = '''  - hostname: ${HOST}
    path: "^/${NAME}(/|\$)"
    service: http://localhost:${PORT}
    originRequest:
      connectTimeout: 60s
      tcpKeepAlive: 30s
      keepAliveConnections: 10
      keepAliveTimeout: 90s
'''

# Insert before first "- hostname:" rule (after "ingress:" line)
if 'ingress:' in content:
    content = content.replace('ingress:\n', 'ingress:\n' + new_rule, 1)
    with open('${CF_CONFIG}', 'w') as f:
        f.write(content)
    print("  patched ok")
else:
    print("  warning: could not find 'ingress:' section", file=sys.stderr)
    sys.exit(1)
PYEOF
      ok "Route /${NAME} → localhost:${PORT} added to ${CF_CONFIG}"
    fi

    # Validate
    if command -v cloudflared &>/dev/null; then
      cloudflared tunnel --config "$CF_CONFIG" ingress validate 2>/dev/null && ok "Config valid" || warn "Config validation warning"
    fi

    # Restart tunnel service
    RESTART_SVC=""
    # Try to find which systemd service is using this config
    if [[ -z "$CF_TUNNEL_SERVICE" ]]; then
      RESTART_SVC=$(grep -rl "$CF_CONFIG" ~/.config/systemd/user/*.service 2>/dev/null | \
        xargs -I{} basename {} .service 2>/dev/null | head -1 || true)
      # Also check common names
      if [[ -z "$RESTART_SVC" ]]; then
        for svc in openclaw-tunnel openclaw cloudflared; do
          if systemctl --user is-active "$svc" &>/dev/null; then
            RESTART_SVC="$svc"; break
          fi
        done
      fi
    else
      RESTART_SVC="$CF_TUNNEL_SERVICE"
    fi

    if [[ -n "$RESTART_SVC" ]]; then
      systemctl --user restart "$RESTART_SVC"
      sleep 2
      STATUS=$(systemctl --user is-active "$RESTART_SVC" 2>/dev/null || echo "unknown")
      ok "Tunnel service '${RESTART_SVC}' restarted (${STATUS})"
    else
      warn "Could not detect tunnel systemd service — restart it manually"
      info "  systemctl --user restart <your-tunnel-service>"
    fi
  fi
}

# ── Handle Cloudflare tunnel ──────────────────────────────────────────────────
if [[ "$NO_TUNNEL" = false && "$MODE" = "docker" ]]; then
  if [[ -n "$CF_TOKEN" || -n "$CF_CONFIG" ]] || ls ~/.cloudflared/*.yml &>/dev/null 2>&1; then
    setup_cloudflare
  else
    info "No Cloudflare config detected — skipping tunnel setup"
    info "  Use --cf-token TOKEN or --cf-config PATH to enable"
  fi
fi

# ── Wait for container readiness ──────────────────────────────────────────────
if [[ "$MODE" = "docker" ]]; then
  step "Waiting for wizard to be ready..."
  READY=false
  for i in $(seq 1 20); do
    if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
      READY=true; break
    fi
    sleep 2
  done

  if [[ "$READY" = true ]]; then
    ok "Wizard is ready!"
  else
    warn "Wizard not responding after 40s — container may still be starting"
    info "  docker logs ${NAME}"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  OpenClaw '${NAME}' is deployed!  ${RESET}${GREEN}${BOLD}║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

if [[ -n "$HOST" ]]; then
  echo -e "  ${BOLD}Setup Wizard:${RESET}   ${BLUE}https://${HOST}/${NAME}/${RESET}"
  echo -e "  ${BOLD}Gateway UI:${RESET}     ${BLUE}https://${HOST}/${NAME}/gateway/${RESET}"
  [[ "$OV_VAL" = "true" ]] && \
    echo -e "  ${BOLD}OpenViking:${RESET}     ${BLUE}https://${HOST}/${NAME}/openviking/${RESET}"
else
  echo -e "  ${BOLD}Setup Wizard:${RESET}   ${BLUE}http://localhost:${PORT}/${NAME}/${RESET}"
  echo ""
  echo -e "  ${DIM}For public access, re-run with:${RESET}"
  echo -e "  ${DIM}  --host your.domain.com --cf-token TOKEN${RESET}"
fi

echo ""
echo -e "  ${DIM}Manage:${RESET}"
echo -e "  ${DIM}  docker logs -f ${NAME}${RESET}"
echo -e "  ${DIM}  docker stop ${NAME} && docker rm ${NAME}${RESET}"
echo -e "  ${DIM}  docker volume rm ${DATA_DIR}   # ⚠️ deletes all data${RESET}"
echo ""
