# Production-grade Dockerfile for Inspectra Legal Metrology Platform
FROM node:20-bookworm-slim AS base

# Install Python, Tesseract OCR, and system image processing dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-eng \
    libvips-dev \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./
COPY prisma ./prisma/

# Install Node dependencies
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy application source code
COPY . .

# Build Next.js application
RUN npm run build

# Create Python virtual environment and install ML requirements
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir pillow pypdf

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Expose Next.js server port
EXPOSE 3000

# Apply database migrations, seed statutory data, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run seed && npm run start"]
