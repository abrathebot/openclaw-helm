FROM node:22-alpine

RUN npm install -g openclaw

COPY setup-wizard/ /wizard/
RUN cd /wizard && npm install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# /data is the isolated state dir — mounted as PVC per pod
RUN mkdir -p /data
VOLUME ["/data"]

# Only expose wizard port — gateway (18789) is internal only
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
