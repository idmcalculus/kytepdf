FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-eng \
    ghostscript \
    poppler-utils \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for running the application
RUN useradd -r -m -s /bin/false appuser \
    && mkdir -p /tmp/lo-appuser \
    && chown appuser:appuser /tmp/lo-appuser

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# Drop to non-root user
USER appuser

ENV NODE_ENV=production
ENV PORT=8080
ENV OMP_THREAD_LIMIT=1

EXPOSE 8080
CMD ["npm", "start"]
