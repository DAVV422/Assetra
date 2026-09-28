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
