FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip python3-venv make g++ curl bash ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g openclaw

# Install rtk — CLI proxy that compresses command output 60-90% for LLM agents
# rtk is wired into Claude Code / openclaw coding agents via rtk init --global
RUN curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash && \
    find /root/.local/bin /root/.cargo/bin /usr/local/cargo/bin -name rtk 2>/dev/null | head -1 | xargs -I{} mv {} /usr/local/bin/rtk || true

# ── LiteLLM + OpenViking (fully isolated knowledge base) ─────────────────────
# LiteLLM proxy: routes Claude token to OpenAI-compatible API for OpenViking
# fastembed: local embedding model (no API key needed, ~100MB on first use)
RUN pip install --break-system-packages --no-cache-dir \
    "litellm[proxy]>=1.40.0" \
    "fastembed>=0.3.6" \
    "openviking>=0.1.6" \
    "mcp>=1.8.0"

# Clone OpenViking MCP server (for server.py + common/ imports)
RUN git clone --depth 1 https://github.com/volcengine/OpenViking /opt/openviking

# Copy knowledge base seeding script + bundled skills
COPY scripts/seed-knowledge.sh /opt/seed-knowledge.sh
RUN chmod +x /opt/seed-knowledge.sh
COPY skills/ /opt/skills/

COPY setup-wizard/ /wizard/
RUN cd /wizard && npm install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# /data is the isolated state dir — mounted as PVC per pod
RUN mkdir -p /data
VOLUME ["/data"]

# Increase gateway WS handshake timeout for CF tunnel latency
ENV VITEST=1
ENV OPENCLAW_TEST_HANDSHAKE_TIMEOUT_MS=30000

# Only expose wizard port — gateway (18789) is internal only
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
