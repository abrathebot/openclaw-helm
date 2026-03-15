#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
DIM='\033[2m'
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

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

# Check prerequisites
for cmd in kubectl helm; do
  if ! command -v "$cmd" &> /dev/null; then
    echo -e "${RED}Error: $cmd is not installed.${RESET}"
    echo "Please install $cmd first and try again."
    exit 1
  fi
done
echo -e "${GREEN}Prerequisites met: kubectl, helm${RESET}"

# Namespace
read -rp "$(echo -e "${BOLD}Namespace${RESET} [openclaw]: ")" NS
NS="${NS:-openclaw}"

# Create namespace if it doesn't exist
if ! kubectl get namespace "$NS" &> /dev/null; then
  echo -e "${DIM}Creating namespace ${NS}...${RESET}"
  kubectl create namespace "$NS"
fi

# Determine chart path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_PATH="$SCRIPT_DIR"

if [ ! -f "$CHART_PATH/Chart.yaml" ]; then
  echo -e "${RED}Error: Chart.yaml not found in $CHART_PATH${RESET}"
  echo "Please run this script from the openclaw-helm directory."
  exit 1
fi

# Install
echo ""
echo -e "${BOLD}Installing OpenClaw...${RESET}"
helm upgrade --install openclaw "$CHART_PATH" -n "$NS" --wait --timeout 120s

echo ""
echo -e "${GREEN}${BOLD}OpenClaw installed successfully!${RESET}"
echo ""

# Get service info
SVC_NAME=$(kubectl get svc -n "$NS" -l app.kubernetes.io/name=openclaw -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "openclaw")
SVC_TYPE=$(kubectl get svc "$SVC_NAME" -n "$NS" -o jsonpath='{.spec.type}' 2>/dev/null || echo "ClusterIP")

if [ "$SVC_TYPE" = "LoadBalancer" ]; then
  EXTERNAL_IP=$(kubectl get svc "$SVC_NAME" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [ -n "$EXTERNAL_IP" ]; then
    echo -e "Setup Wizard: ${BOLD}${BLUE}http://${EXTERNAL_IP}:3000${RESET}"
  else
    echo -e "${DIM}LoadBalancer IP pending. Run: kubectl get svc $SVC_NAME -n $NS${RESET}"
  fi
else
  echo -e "${BOLD}Access the setup wizard via port-forward:${RESET}"
  echo ""
  echo -e "  ${BLUE}kubectl port-forward svc/$SVC_NAME 3000:3000 -n $NS${RESET}"
  echo ""
  echo -e "Then open: ${BOLD}${BLUE}http://localhost:3000${RESET}"
fi

echo ""
echo -e "${DIM}After setup, the gateway will be available on port 18789.${RESET}"
