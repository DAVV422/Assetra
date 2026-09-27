# Assetra Frontend

Dashboard web para crear y administrar activos RWA en Stellar.

## Responsabilidades

- Crear y listar activos tokenizados.
- Administrar participantes autorizados.
- Registrar documentos verificables.
- Ejecutar mint, burn, pause, freeze y redencion mediante el backend.
- Mostrar estados de transaccion, errores y enlaces al explorer.

## Regla de integracion

El frontend no llamara directamente a los contratos. Consumira una interfaz estable del backend para poder trabajar primero con datos simulados y cambiar despues a Stellar Testnet sin rehacer las pantallas.
