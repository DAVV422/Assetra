# Assetra Backend

API Express + TypeScript que desacopla el dashboard de los contratos Soroban.

## Incluye

- API REST para activos, ciclo de vida, participantes y documentos.
- Validación de entradas con Zod y errores HTTP consistentes.
- Cabeceras de seguridad con `helmet` y límite de peticiones por IP con `express-rate-limit` (300/min en `/api`, 30/min para escrituras; `429 RATE_LIMITED`). Configurable con `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_WRITES_PER_MINUTE` y `TRUST_PROXY` (usa `1` en Koyeb).
- `AssetraClient` como frontera estable de integración.
- `MockAssetraClient` y fixtures reproducibles para desarrollo paralelo.
- `ChainAssetraClient` (modo live): lectura on-chain y verificación de transacciones firmadas por los usuarios.
- Pruebas de integración con Vitest y Supertest.

## Ejecución

```bash
npm run dev -w backend
npm run test -w backend
npm run build -w backend
```

La API inicia en `http://localhost:4000`. Consulta [docs/API.md](docs/API.md) para las rutas disponibles. La implementación real de Stellar conservará la misma interfaz, evitando cambios en el frontend cuando Persona 1 entregue los contratos.

## Despliegue con Docker

### Opción 1: Docker Compose (Recomendado)

Desde la raíz del repositorio:
```bash
docker compose up --build -d
```

Para consultar el estado y logs en tiempo real:
```bash
docker compose logs -f backend
```

Para detener el servicio:
```bash
docker compose down
```

### Opción 2: Docker CLI

```bash
# 1. Construir la imagen (contexto: carpeta backend/, igual que en Koyeb)
docker build -t assetra-backend ./backend

# 2. Iniciar el contenedor (Modo Live o Mock)
docker run -d \
  --name assetra-backend \
  -p 127.0.0.1:4000:4000 \
  -e ASSETRA_MODE=live \
  --env-file backend/.env \
  -v ${PWD}/backend/data:/app/data \
  assetra-backend
```

### Modo `live`: sin claves en el servidor

El backend **no firma transacciones**: los usuarios firman con Freighter en el navegador. En modo `live` la API:

- Lee la cadena por RPC (`get_asset`, `wallet_status`, `total_supply`…) para saldos, estados y whitelist.
- Solo acepta escrituras con el `txHash` de una transacción exitosa, firmada por la cuenta con el rol correcto, sobre el contrato, función y activo esperados. Cada hash se usa una sola vez.
- Guarda los metadatos (nombre, descripción, nombres de participantes) en `data/chain-assets.json`. En Koyeb conviene un volumen persistente para no perderlos.

No hace falta configurar secretos ni montar identidades del Stellar CLI.

El contenedor cuenta con:
- Multi-stage build sobre `node:22-alpine`: la imagen final no incluye `npm`, `npx` ni `corepack` y aplica `apk upgrade`. `backend/contracts.json` se copia en la imagen (lo actualizan `script:deploy` y `script:seed`).
- Sin Stellar CLI ni claves. Escaneo Trivy (2026-10-09): 0 vulnerabilidades altas o críticas.
- Ejecución como usuario sin privilegios `node`; en compose, `no-new-privileges` y sin capabilities.
- Volumen en `/app/data` para persistencia de activos entre reinicios. En Linux, el directorio del host debe ser escribible por el UID 1000.
- Endpoint de verificación de salud automático (`HEALTHCHECK` en `/health`).

