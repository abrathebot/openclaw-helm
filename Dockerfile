FROM node:22-alpine

RUN npm install -g openclaw

COPY setup-wizard/ /wizard/
RUN cd /wizard && npm install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000 18789

ENTRYPOINT ["/entrypoint.sh"]
