# syntax=docker/dockerfile:1
# ── Frontend (Next.js) ─────────────────────────────────────────────────────────
# Containers ship Node 20, which sidesteps the host's Node 18 limitation
# (Next 16 requires Node >= 20.9).
FROM node:20-alpine

WORKDIR /app

# The browser talks to the backend via this URL. It is baked in at build time
# for the client bundle (NEXT_PUBLIC_*) and also available at runtime.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the app and build.
COPY . .
RUN npm run build

EXPOSE 3000

# `next start` serves the production build on port 3000.
CMD ["npm", "start"]
