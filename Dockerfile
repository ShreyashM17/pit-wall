FROM node:24-alpine
# tini = proper PID 1, so `docker stop` (SIGTERM) shuts the server down at once instead of waiting 10s for SIGKILL
RUN apk add --no-cache tini
WORKDIR /app
COPY server.js ./
COPY public ./public
COPY src ./src
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/pitwall.db
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:$PORT/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
