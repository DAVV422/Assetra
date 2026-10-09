# Assetra API

Base local: `http://localhost:4000`

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Estado y modo (`mock` / `live`) de la API |
| GET | `/api/config` | Red y contrato `RwaRegistry` (solo modo live) |
| GET | `/api/assets` | Listar activos |
| GET | `/api/assets/:assetId` | Consultar un activo |
| POST | `/api/assets` | Registrar un activo |
| POST | `/api/assets/:assetId/actions` | activate, mint, burn, pause, unpause o redeem |
| POST | `/api/assets/:assetId/transfers` | Registrar una transferencia |
| POST | `/api/assets/:assetId/participants` | Añadir participante |
| PATCH | `/api/assets/:assetId/participants/:participantId` | Cambiar autorización |
| POST | `/api/assets/:assetId/documents` | Registrar documento |

## Modo live: prueba de autoría

El backend no tiene claves. Toda escritura debe incluir `txHash`: el hash de la transacción que el usuario firmó con Freighter. La API la consulta en el RPC y la acepta solo si fue exitosa, la firmó la cuenta con el rol requerido y llama al contrato, función y activo esperados. Cada hash se acepta una sola vez.

| Operación | Firmante exigido | Contrato / función |
|---|---|---|
| Crear activo | `creatorWallet` (emisor aprobado) | `RwaRegistry.create_asset` |
| activate / unpause / redeem | Emisor o compliance | `RwaRegistry.set_asset_status` |
| pause | Emisor, compliance o admin | `RwaRegistry.set_asset_status` |
| mint | Emisor | `Token.mint` |
| burn | El titular | `Token.burn` |
| Transferencia | `from` | `Token.transfer` |
| Participante / estado | Compliance | `authorize_wallet` / `revoke_wallet` / `freeze_wallet` |
| Documento | Emisor o compliance | `RwaRegistry.add_document` |

Errores propios: `TX_PROOF_REQUIRED`, `TX_NOT_CONFIRMED`, `TX_MISMATCH`, `TX_ALREADY_USED`, `INVALID_TX_HASH`.

En modo mock las mismas rutas funcionan sin `txHash` (simulación).

## Límites y cabeceras

- Cada IP puede hacer hasta `RATE_LIMIT_PER_MINUTE` (300) peticiones por minuto a `/api` y `RATE_LIMIT_WRITES_PER_MINUTE` (30) escrituras. Al superarlo: `429 { "error": "RATE_LIMITED" }`, con las cabeceras estándar `RateLimit`, `RateLimit-Policy` y `Retry-After`. `/health` no tiene límite.
- Todas las respuestas incluyen cabeceras de seguridad (`helmet`): `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`.
- Detrás de un proxy (Koyeb) define `TRUST_PROXY=1` para que el límite se cuente por la IP real del cliente.
