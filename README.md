# OpenClaw Helm Chart

Deploy [OpenClaw](https://github.com/openclaw/openclaw) — an AI butler for Telegram, WhatsApp, and more — on Kubernetes with an interactive web setup wizard.

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         Kubernetes Pod           │
                    │                                  │
  Browser ──────>  │  :3000  Setup Wizard (first run) │
                    │         writes config to PVC     │
                    │              │                    │
                    │              ▼                    │
  Telegram/WA ──>  │  :18789 OpenClaw Gateway          │
                    │         (after config exists)     │
                    │                                  │
                    │  /data (PVC)                     │
                    │   ├── .openclaw/openclaw.json    │
                    │   └── workspace/                 │
                    └─────────────────────────────────┘
```

## Quick Start

**1. Clone and install**

```bash
git clone https://github.com/openclaw/openclaw-helm.git
cd openclaw-helm
bash install.sh
```

**2. Port-forward to the wizard**

```bash
kubectl port-forward svc/openclaw 3000:3000 -n openclaw
```

**3. Open the wizard**

Navigate to http://localhost:3000 and follow the setup steps.

## Helm Install (manual)

```bash
helm install openclaw . -n openclaw --create-namespace
```

### With pre-configuration (skip wizard)

```bash
helm install openclaw . -n openclaw --create-namespace \
  --set preConfig.enabled=true \
  --set preConfig.anthropicApiKey=sk-ant-... \
  --set preConfig.telegramBotToken=123456:ABC... \
  --set preConfig.telegramAllowFrom='{123456789}'
```

## Values Reference

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `ghcr.io/openclaw/openclaw` | Container image |
| `image.tag` | `latest` | Image tag |
| `service.wizardPort` | `3000` | Setup wizard port |
| `service.gatewayPort` | `18789` | OpenClaw gateway port |
| `service.type` | `ClusterIP` | Service type |
| `ingress.enabled` | `false` | Enable ingress |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.host` | `openclaw.yourdomain.com` | Ingress hostname |
| `persistence.enabled` | `true` | Enable PVC for /data |
| `persistence.size` | `2Gi` | PVC size |
| `persistence.storageClass` | `""` | Storage class (empty = default) |
| `resources.requests.memory` | `256Mi` | Memory request |
| `resources.requests.cpu` | `100m` | CPU request |
| `resources.limits.memory` | `1Gi` | Memory limit |
| `resources.limits.cpu` | `500m` | CPU limit |
| `preConfig.enabled` | `false` | Skip wizard, use values |
| `preConfig.anthropicApiKey` | `""` | Claude API key |
| `preConfig.telegramBotToken` | `""` | Telegram bot token |
| `preConfig.telegramAllowFrom` | `[]` | Allowed Telegram user IDs |
| `preConfig.geminiApiKey` | `""` | Gemini API key (web search) |
| `preConfig.gatewayPort` | `18789` | Gateway port |
| `preConfig.gatewayToken` | `""` | Gateway auth token |
| `preConfig.model` | `anthropic/claude-sonnet-4-6` | Default AI model |

## Docker (standalone)

```bash
docker build -t openclaw .
docker run -d -p 3000:3000 -p 18789:18789 -v openclaw-data:/data openclaw
```

Open http://localhost:3000 to configure.

## Upgrading

```bash
helm upgrade openclaw . -n openclaw
```

Your configuration in the PVC is preserved across upgrades.

## Troubleshooting

**Wizard not loading**
```bash
kubectl logs -n openclaw deploy/openclaw
kubectl describe pod -n openclaw -l app.kubernetes.io/name=openclaw
```

**Config issues — reset wizard**
```bash
kubectl exec -n openclaw deploy/openclaw -- rm /data/.openclaw/openclaw.json
kubectl rollout restart deploy/openclaw -n openclaw
```

**Port conflict**
```bash
# Check if ports are in use
kubectl get svc -n openclaw
```

## License

MIT
