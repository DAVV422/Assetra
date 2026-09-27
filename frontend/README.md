# Assetra Frontend

Dashboard React + TypeScript para crear y administrar activos RWA permissioned en Stellar.

## Funcionalidades

- Resumen de valor registrado, activos, participantes y documentos.
- Portafolio y detalle administrativo por activo.
- Mint, burn, pause, unpause y redención simulados.
- Alta y autorización de participantes.
- Registro de hashes documentales y versiones.
- Flujo guiado de creación de activos.
- Diseño responsive accesible para escritorio y móvil.

## Ejecución

```bash
npm run dev -w frontend
npm run test -w frontend
npm run build -w frontend
```

Por defecto se usa `MockAssetraClient`. Copia `.env.example` a `.env` y configura `VITE_ASSETRA_CLIENT=http` para consumir la API. El frontend no llama directamente a los contratos, por lo que puede avanzar sin esperar el ABI de Soroban.
