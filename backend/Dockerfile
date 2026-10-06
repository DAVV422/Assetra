# ==========================================
# 1. Build Stage: Compilación de TypeScript
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copiar manifiesto de dependencias y configuración de TS
COPY package.json tsconfig.json ./
RUN npm install

# Copiar código fuente y compilar a JavaScript
COPY src ./src
RUN npm run build

# ==========================================
# 2. Production Stage: Imagen final optimizada
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV ASSETRA_MODE=live

# Instalar dependencias del sistema y Stellar CLI para invocaciones en Testnet
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libdbus-1-3 \
    && curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copiar package.json e instalar solo dependencias de producción
COPY package.json ./
RUN npm install --omit=dev

# Copiar archivos compilados desde el builder
COPY --from=builder /app/dist ./dist

# Copiar configuración de contratos y directorio de datos para persistencia
COPY contracts.json ./contracts.json
COPY data ./data

EXPOSE 4000

# Verificación de salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/src/index.js"]
