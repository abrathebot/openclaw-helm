FROM node:22-alpine

RUN apk add --no-cache git python3 make g++ && \
    npm install -g openclaw

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
