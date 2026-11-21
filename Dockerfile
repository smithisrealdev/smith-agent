# Smith Agent: web app, API and LINE bot in one container, with Chromium for evidence screenshots.
FROM node:22-bookworm-slim
WORKDIR /app

# Browsers go to a shared path so the non-root user below can launch them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm install --no-save playwright@1.63.0 \
 && npx playwright install --with-deps chromium \
 && rm -rf /root/.npm \
 && mkdir -p /data && chown node:node /data

COPY src ./src
COPY public ./public

# Mount a persistent volume at /data: it holds the SQLite database and the evidence screenshots.
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/smith.db EVIDENCE_DIR=/data/evidence
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
