# Assetra API

Base local: `http://localhost:4000`

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Estado de la API |
| GET | `/api/assets` | Listar activos |
| GET | `/api/assets/:assetId` | Consultar un activo |
| POST | `/api/assets` | Registrar un activo |
| POST | `/api/assets/:assetId/actions` | Mint, burn, pause, unpause o redeem |
| POST | `/api/assets/:assetId/participants` | Añadir participante |
| PATCH | `/api/assets/:assetId/participants/:participantId` | Cambiar autorización |
| POST | `/api/assets/:assetId/documents` | Registrar documento |

El adaptador HTTP y el cliente simulado implementan la misma interfaz. Cuando Persona 1 entregue ABI, eventos, errores e IDs de contratos, `StellarAssetraClient` sustituirá el mock sin cambiar las rutas ni las pantallas.
