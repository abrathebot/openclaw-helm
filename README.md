# OpenClaw Helm Chart

Deploy [OpenClaw](https://openclaw.ai) — your self-hosted AI butler — on Kubernetes in one command.

## One-Click Install

```bash
# Quickstart (no ingress, access via port-forward)
curl -fsSL https://raw.githubusercontent.com/abrathebot/openclaw-helm/master/install.sh | bash

# With ingress host (production)
curl -fsSL https://raw.githubusercontent.com/abrathebot/openclaw-helm/master/install.sh | \
  bash -s -- --host ai.example.com

# Custom release name + namespace
curl -fsSL https://raw.githubusercontent.com/abrathebot/openclaw-helm/master/install.sh | \
  bash -s -- --host ai.example.com --name mybot --namespace bots
```

Or clone and run locally:

```bash
git clone https://github.com/abrathebot/openclaw-helm.git
cd openclaw-helm
./install.sh --host ai.example.com
```

## What You Get

After install, three URLs are live at `https://<host>/<release>/`:

| URL | Purpose |
|-----|---------|
| `/<release>/` | Setup wizard — configure API keys, channels, models |
| `/<release>/gateway/` | Control UI — chat, sessions, cron, config |
| `/<release>/openviking/` | OpenViking context DB (AI memory persistence) |

## Batteries Included

| Component | Default | Notes |
|-----------|---------|-------|
| **OpenClaw gateway** | ✅ | AI butler, all channels |
| **Setup wizard** | ✅ | Web UI for first-run config |
| **OpenViking** | ✅ on | Context database for agent memory |
| **rtk** | ✅ on | CLI proxy (60-90% token compression for coding agents) |
| **Persistent storage** | ✅ | PVC for config, workspace, memory |

## Helm (manual)

```bash
helm upgrade --install openclaw . \
  --namespace openclaw \
  --create-namespace \
  --set ingress.host=ai.example.com \
  --wait
```

## values.yaml highlights

```yaml
ingress:
  host: ai.example.com   # your domain

openviking:
  enabled: true          # context DB for AI memory
  persistence:
    size: 5Gi

rtk:
  enabled: true          # CLI token compression

persistence:
  size: 2Gi              # gateway config + workspace

resources:
  requests:
    memory: 256Mi
    cpu: 100m
```

## Requirements

- Kubernetes 1.24+
- Helm 3.x
- nginx-ingress controller (for ingress) — or use port-forward for local
- PersistentVolume support (default StorageClass)

## Architecture

```
Browser → Ingress → /<release>/* → Wizard (port 3000)
                                     │
                                     ├── /gateway/* → WS proxy → Gateway (18789, internal)
                                     └── /openviking/* → OpenViking (1933, internal)
```

- **Gateway** runs internally on port 18789 — never exposed directly to ingress
- **Wizard** handles WS proxy with automatic token injection and device-auth bypass
- **OpenViking** runs as a separate Deployment with its own PVC

## Uninstall

```bash
helm uninstall openclaw -n openclaw
# To also delete PVCs (data):
kubectl delete pvc -n openclaw -l app.kubernetes.io/instance=openclaw
```
