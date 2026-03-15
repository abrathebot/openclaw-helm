# openclaw-helm

Deploy [OpenClaw](https://github.com/openclaw/openclaw) on Kubernetes — multi-tenant, path-based routing, fully isolated per pod.

## Architecture

```
                    Kubernetes Cluster
                    ┌─────────────────────────────────────────────┐
                    │                                             │
  ai.openclaw.id/alice/*  ──>  Pod: openclaw-alice               │
                    │          ├── /data/.openclaw/ (PVC-alice)   │
                    │          └── wizard:3000 + gateway:18789    │
                    │                                             │
  ai.openclaw.id/bob/*    ──>  Pod: openclaw-bob                  │
                    │          ├── /data/.openclaw/ (PVC-bob)     │
                    │          └── wizard:3000 + gateway:18789    │
                    └─────────────────────────────────────────────┘
```

Each Helm release = one isolated OpenClaw instance with its own:
- Config & credentials (`/data/.openclaw/`)
- Workspace (`/data/.openclaw/workspace/`)
- URL path (`/{release-name}/`)

**The host machine's OpenClaw is never touched.**

## URL Routing

| URL | Purpose |
|-----|---------|
| `https://ai.openclaw.id/{name}/` | Setup wizard |
| `https://ai.openclaw.id/{name}/dashboard` | Dashboard |
| `https://ai.openclaw.id/{name}/gateway/` | OpenClaw gateway UI |

## Deploy an instance

```bash
# Clone chart
git clone https://github.com/abrathebot/openclaw-helm.git
cd openclaw-helm

# Deploy "alice" instance
helm install openclaw-alice . \
  --namespace openclaw-alice --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=ai.openclaw.id

# Deploy "bob" instance  
helm install openclaw-bob . \
  --namespace openclaw-bob --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=ai.openclaw.id
```

Then open:
- `https://ai.openclaw.id/openclaw-alice/` → Alice's wizard
- `https://ai.openclaw.id/openclaw-bob/` → Bob's wizard

## How it works

1. **First visit** → wizard shows setup UI (no config yet)
2. **Fill wizard** → writes `openclaw.json` + `auth-profiles.json` to pod's `/data/`
3. **Gateway auto-starts** inside the container after config is written
4. **Gateway UI** available at `/{name}/gateway/` (proxied by wizard)

## Values Reference

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `ghcr.io/abrathebot/openclaw` | Container image |
| `image.tag` | `latest` | Image tag |
| `ingress.enabled` | `true` | Enable ingress |
| `ingress.host` | `ai.openclaw.id` | Shared hostname |
| `ingress.className` | `nginx` | Ingress class |
| `persistence.enabled` | `true` | Enable PVC |
| `persistence.size` | `2Gi` | PVC size |
| `service.port` | `3000` | Wizard port (only port exposed) |

## Docker (standalone)

```bash
docker build -t openclaw .

# Run as "mybot"
docker run -d \
  -p 3000:3000 \
  -v openclaw-mybot:/data \
  -e BASE_PATH=/mybot \
  -e INGRESS_HOST=ai.openclaw.id \
  openclaw
```

Open `http://localhost:3000/mybot` to configure.

## Reset an instance

```bash
kubectl exec -n openclaw-alice deploy/openclaw-alice -- \
  rm /data/.openclaw/openclaw.json
kubectl rollout restart deploy/openclaw-alice -n openclaw-alice
```

## Upgrade

```bash
helm upgrade openclaw-alice . -n openclaw-alice
```

Config in PVC is preserved across upgrades.
