# ── Base image ───────────────────────────────────────────────
# Node 20 LTS on Alpine — minimal footprint for Cloud Run
FROM node:20-alpine

# ── Working directory ─────────────────────────────────────────
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────
# Copy package files first for better layer cache reuse:
# dependencies only reinstall when package.json changes.
COPY package*.json ./
RUN npm ci --omit=dev

# ── Copy source ───────────────────────────────────────────────
COPY api/      ./api/
COPY data/     ./data/
COPY public/   ./public/
COPY server.js ./

# ── Cloud Run expects the server on $PORT (default 8080) ──────
EXPOSE 8080

# ── Health: Cloud Run expects a process that stays alive ──────
ENV NODE_ENV=production

# ── Start ─────────────────────────────────────────────────────
CMD ["node", "server.js"]
