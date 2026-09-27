# Assetra Backend

Capa de integracion entre el dashboard y los contratos Soroban.

## Responsabilidades

- Exponer una API estable para el frontend.
- Implementar AssetraClient y MockAssetraClient.
- Preparar tipos compartidos, validaciones y manejo de errores.
- Construir, simular y enviar transacciones a Stellar Testnet.
- Mantener fixtures reproducibles para la factura, wallets y estados de la demo.
- Ocultar al frontend los detalles del ABI y las direcciones de contratos.

## Trabajo paralelo

MockAssetraClient sera la primera implementacion. La integracion real con Stellar mantendra la misma interfaz, permitiendo que frontend y contracts avancen sin bloquearse.
