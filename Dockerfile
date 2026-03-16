FROM node:22-alpine

RUN apk add --no-cache git python3 make g++ curl bash && \
    npm install -g openclaw

# Install rtk — CLI proxy that compresses command output 60-90% for LLM agents
# rtk is wired into Claude Code / openclaw coding agents via rtk init --global
RUN curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash && \
    find /root/.local/bin /root/.cargo/bin /usr/local/cargo/bin -name rtk 2>/dev/null | head -1 | xargs -I{} mv {} /usr/local/bin/rtk || true

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
