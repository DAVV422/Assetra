# Assetra

Infraestructura modular para registrar, emitir y administrar activos del mundo real (RWA) sobre Stellar.

El MVP usa una factura comercial ficticia en Stellar Testnet para demostrar registro de activos, documentos verificables, participantes autorizados, emisión, transferencias permissioned y redención.

## Estructura

- `frontend/`: dashboard web de administración.
- `backend/`: API, SDK, cliente simulado e integración futura con Soroban.
- `contracts/`: contratos Soroban desarrollados por la Persona 1.

## Inicio rápido

```bash
npm install
npm run dev
```

El frontend se inicia en `http://localhost:5173` y la API en `http://localhost:4000`.

## Comandos

```bash
npm run dev
npm run build
npm run test
npm run typecheck
```

## Desarrollo paralelo

El frontend consume la interfaz `AssetraClient`. Por defecto utiliza `MockAssetraClient`, así que funciona aunque los contratos todavía no estén desplegados. Para usar la API:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Configura `VITE_ASSETRA_CLIENT=http` en el frontend. La futura implementación Stellar conservará la misma interfaz.

## Alcance del trabajo de Persona 2

- Dashboard responsive con estética editorial y brutalista.
- Flujo de creación y administración de activos.
- Gestión de participantes y documentos.
- Acciones de ciclo de vida simuladas.
- API REST mock-first.
- SDK con adaptadores mock, HTTP y Stellar-ready.
- Fixtures, pruebas y documentación de integración.
