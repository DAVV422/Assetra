# Contexto de build: carpeta backend/ (así lo usa Koyeb y backend/docker-compose.yml)
#   docker build -t assetra-backend ./backend
#
# El backend no firma transacciones ni guarda claves: solo lee Soroban por RPC y verifica
# las transacciones que los usuarios firman con su wallet. No necesita Stellar CLI.

# ==========================================
# 1. Build: compilación de TypeScript
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

# ==========================================
# 2. Dependencias de producción
# ==========================================
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ==========================================
# 3. Imagen final: solo Node + app (sin npm, npx ni corepack)
# ==========================================
FROM node:22-alpine AS runner

# Parches de seguridad del sistema y eliminación del gestor de paquetes de Node:
# en tiempo de ejecución no se necesita y es la principal fuente de CVEs de la imagen base.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production
ENV PORT=4000
ENV ASSETRA_MODE=live

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json contracts.json ./

# Directorio de metadatos escribible por el usuario sin privilegios
RUN mkdir -p data && chown -R node:node data

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/src/index.js"]
