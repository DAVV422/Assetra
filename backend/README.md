# Assetra Backend

API Express + TypeScript que desacopla el dashboard de los contratos Soroban.

## Incluye

- API REST para activos, ciclo de vida, participantes y documentos.
- Validación de entradas con Zod y errores HTTP consistentes.
- `AssetraClient` como frontera estable de integración.
- `MockAssetraClient` y fixtures reproducibles para desarrollo paralelo.
- Esqueleto `StellarAssetraClient` para incorporar ABI e IDs de contratos.
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
# 1. Construir la imagen optimizada
docker build -t assetra-backend ./backend

# 2. Iniciar el contenedor (Modo Live o Mock)
docker run -d \
  --name assetra-backend \
  -p 4000:4000 \
  -e PORT=4000 \
  -e ASSETRA_MODE=live \
  -v ${PWD}/backend/data:/app/data \
  assetra-backend
```

El contenedor cuenta con:
- Multi-stage build con `node:22-bookworm-slim` para mínima superficie de ataque y tamaño reducido.
- `stellar-cli` preinstalado y configurado en el sistema para interacciones reales con Soroban en Testnet.
- Volumen montable en `/app/data` para persistencia continua de activos entre reinicios.
- Endpoint de verificación de salud automático (`HEALTHCHECK` en `/health`).

