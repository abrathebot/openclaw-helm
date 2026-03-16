#!/usr/bin/env bash
# OpenClaw one-click installer
# Usage:
#   ./install.sh                          # interactive
#   ./install.sh --host ai.example.com    # non-interactive, set ingress host
#   ./install.sh --host ai.example.com --name mybot --namespace openclaw
#   curl -fsSL https://raw.githubusercontent.com/abrathebot/openclaw-helm/master/install.sh | bash
set -euo pipefail

BOLD='\033[1m'
DIM='\033[2m'
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

# ── Defaults ──────────────────────────────────────────────────────────────────
RELEASE_NAME="openclaw"
NAMESPACE="openclaw"
INGRESS_HOST=""
NON_INTERACTIVE=false
CHART_VERSION=""   # empty = use local chart (or HEAD if fetched via curl)
OPENVIKING_ENABLED="true"
RTK_ENABLED="true"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)     INGRESS_HOST="$2"; NON_INTERACTIVE=true; shift 2 ;;
    --name)     RELEASE_NAME="$2"; shift 2 ;;
    --namespace|-n) NAMESPACE="$2"; shift 2 ;;
    --no-openviking) OPENVIKING_ENABLED="false"; shift ;;
    --no-rtk)   RTK_ENABLED="false"; shift ;;
    --version)  CHART_VERSION="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--host HOSTNAME] [--name RELEASE] [--namespace NS]"
      echo "       [--no-openviking] [--no-rtk] [--version CHART_VER]"
      exit 0 ;;
    *) echo -e "${RED}Unknown option: $1${RESET}"; exit 1 ;;
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
echo -e "${RESET}"
echo -e "${BOLD}OpenClaw Helm Installer${RESET}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
for cmd in kubectl helm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}✗ $cmd is not installed. Please install it and retry.${RESET}"
    exit 1
  fi
done
echo -e "${GREEN}✓ kubectl and helm found${RESET}"

# ── Interactive prompts (only if not given via flags) ─────────────────────────
if [[ "$NON_INTERACTIVE" = false ]]; then
  read -rp "$(echo -e "${BOLD}Release name${RESET} [${RELEASE_NAME}]: ")" _name
  RELEASE_NAME="${_name:-$RELEASE_NAME}"

  read -rp "$(echo -e "${BOLD}Namespace${RESET} [${NAMESPACE}]: ")" _ns
  NAMESPACE="${_ns:-$NAMESPACE}"

  read -rp "$(echo -e "${BOLD}Ingress hostname${RESET} (e.g. ai.example.com, leave blank to skip): ")" _host
  INGRESS_HOST="${_host:-}"
fi

# ── Locate chart ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_PATH="$SCRIPT_DIR"

# If running via curl (no Chart.yaml in cwd), clone into /tmp
if [[ ! -f "$CHART_PATH/Chart.yaml" ]]; then
  echo -e "${DIM}Cloning openclaw-helm chart into /tmp/openclaw-helm...${RESET}"
  CHART_PATH="/tmp/openclaw-helm"
  rm -rf "$CHART_PATH"
  git clone --depth 1 https://github.com/abrathebot/openclaw-helm.git "$CHART_PATH"
fi

# ── Namespace ─────────────────────────────────────────────────────────────────
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo -e "${DIM}Creating namespace ${NAMESPACE}...${RESET}"
  kubectl create namespace "$NAMESPACE"
fi
echo -e "${GREEN}✓ Namespace: ${NAMESPACE}${RESET}"

# ── Build helm set args ───────────────────────────────────────────────────────
SET_ARGS=(
  --set "openviking.enabled=${OPENVIKING_ENABLED}"
  --set "rtk.enabled=${RTK_ENABLED}"
)
if [[ -n "$INGRESS_HOST" ]]; then
  SET_ARGS+=(--set "ingress.host=${INGRESS_HOST}")
fi

# ── Install ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Installing OpenClaw release: ${BLUE}${RELEASE_NAME}${RESET}${BOLD} in namespace: ${BLUE}${NAMESPACE}${RESET}"
[[ -n "$INGRESS_HOST" ]] && echo -e "  Ingress host: ${BLUE}https://${INGRESS_HOST}/${RELEASE_NAME}/${RESET}"
echo -e "  OpenViking: ${OPENVIKING_ENABLED} | rtk: ${RTK_ENABLED}"
echo ""

helm upgrade --install "$RELEASE_NAME" "$CHART_PATH" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --wait --timeout 180s \
  "${SET_ARGS[@]}"

echo ""
echo -e "${GREEN}${BOLD}✓ OpenClaw installed!${RESET}"
echo ""

# ── Post-install info ─────────────────────────────────────────────────────────
SVC_NAME=$(kubectl get svc -n "$NAMESPACE" -l "app.kubernetes.io/instance=${RELEASE_NAME}" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "$RELEASE_NAME")

if [[ -n "$INGRESS_HOST" ]]; then
  echo -e "  ${BOLD}Setup wizard:${RESET}  ${BLUE}https://${INGRESS_HOST}/${RELEASE_NAME}/${RESET}"
  echo -e "  ${BOLD}Gateway UI:${RESET}    ${BLUE}https://${INGRESS_HOST}/${RELEASE_NAME}/gateway/${RESET}"
  [[ "$OPENVIKING_ENABLED" = "true" ]] && \
    echo -e "  ${BOLD}OpenViking:${RESET}    ${BLUE}https://${INGRESS_HOST}/${RELEASE_NAME}/openviking/${RESET}"
else
  echo -e "${BOLD}Access via port-forward:${RESET}"
  echo ""
  echo -e "  ${BLUE}kubectl port-forward svc/${SVC_NAME} 3000:3000 -n ${NAMESPACE}${RESET}"
  echo ""
  echo -e "  Then open: ${BOLD}${BLUE}http://localhost:3000/${RELEASE_NAME}/${RESET}"
fi
echo ""
echo -e "${DIM}Run ${BOLD}helm status ${RELEASE_NAME} -n ${NAMESPACE}${RESET}${DIM} to check status.${RESET}"
echo -e "${DIM}Run ${BOLD}helm uninstall ${RELEASE_NAME} -n ${NAMESPACE}${RESET}${DIM} to remove.${RESET}"
