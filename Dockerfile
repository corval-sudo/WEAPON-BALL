FROM node:20-bookworm-slim

# Install system packages in one layer:
#   ffmpeg  — video encoding for recordings
#   chromium + libs — headless browser for tournament final recording via Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libasound2t64 \
    libxss1 \
    libgtk-3-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Skip Puppeteer's bundled Chromium download — we use the system one above.
# PUPPETEER_EXECUTABLE_PATH tells recording.ts where to find it at runtime.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

EXPOSE 3001

CMD ["npm", "run", "serve"]
