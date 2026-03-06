FROM node:20-bookworm-slim

# Install system packages in one layer:
#   ffmpeg    — video encoding for recordings
#   chromium  — headless browser for Puppeteer (apt resolves all its deps automatically)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Skip Puppeteer's bundled Chromium download — we use the system one above.
# PUPPETEER_EXECUTABLE_PATH tells recording.ts where to find it at runtime.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install backend Node dependencies
COPY package*.json ./
RUN npm ci

# Install frontend dependencies and build
COPY web/package*.json web/
RUN cd web && npm ci

# Copy all source files
COPY . .

# Build frontend (served by Express at runtime)
# VITE_API_URL is empty so the frontend uses relative URLs (same origin as backend)
RUN cd web && VITE_API_URL="" npm run build

EXPOSE 3001

CMD ["npm", "run", "serve"]
