FROM node:22-slim

# better-sqlite3 ships prebuilds for node 22; python/make are only needed if
# it has to fall back to compiling.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm ci, not npm install: it installs exactly what the lockfile pins, so the
# patched multer/qs versions are what actually ship rather than whatever
# resolves at build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads

# No VOLUME declaration: both deployment paths supply their own storage
# (a named volume under compose, a mounted volume on Fly) and an anonymous
# volume here would silently shadow it.
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000
CMD ["node", "server.js"]
