# Assetra: Smart Contracts en Soroban (Stellar)

Infraestructura de contratos inteligentes construida sobre **Stellar Testnet** para la emisión, verificación documental y administración del ciclo de vida de **Activos del Mundo Real (RWA)** permisionados.

---

## 1. Arquitectura de Contratos

El sistema desacopla la lógica documental y regulatoria del movimiento financiero mediante dos contratos en Soroban (Rust):

```
                        [ STELLAR TESTNET ]
                                 │
           ┌─────────────────────┴─────────────────────┐
           ▼                                           ▼
┌──────────────────────┐                    ┌──────────────────────┐
│     RwaRegistry      │                    │     rwa_token        │
│  (Registro Central)  │◀─── consulta ──────│(PermissionedRwaToken)│
│  - Metadatos RWA     │     en transfer    │  - Balances / Supply │
│  - Hashes SHA-256    │                    │  - Mint & Burn       │
│  - Whitelist/Freeze  │                    │  - Pausa de emergencia│
└──────────────────────┘                    └──────────────────────┘
```

### A. `rwa_registry` (Registro, Compliance y Factory de tokens)
* **Ubicación:** `contracts/rwa_registry/src/lib.rs`
* **Constructor:** `__constructor(admin, token_wasm_hash)` — atómico con el deploy: fija el admin de la plataforma y el WASM con el que se despliegan los tokens.
* **Administración (admin):** `approve_issuer`, `revoke_issuer`, `set_admin`, `set_token_wasm`. Consulta: `is_approved_issuer`.
* **Ciclo de vida:**
  * `create_asset(asset_id, issuer, compliance_officer, params)`: **firma el emisor**, que debe estar aprobado. Registra el activo en `Draft` y **despliega su token** (dirección determinista a partir del `asset_id`) con `max_supply`. Devuelve la dirección del token.
  * `add_document(asset_id, caller, doc_hash, uri)`: emisor o compliance. La versión se asigna automáticamente (1, 2, 3…) y es inmutable. Devuelve la versión.
  * `set_asset_status`: máquina de estados `Draft → Active`, `Active ⇄ Paused`, `Active/Paused → Redeemed` (terminal). Emisor o compliance; el admin solo puede **pausar** (freno de emergencia).
* **Compliance:** `authorize_wallet`, `revoke_wallet`, `freeze_wallet` (solo el oficial de compliance del activo). Consultas: `wallet_status`, `is_authorized` (*fail-closed*: sin registro = `Pending`).
* **Consultas:** `get_asset`, `get_token`, `get_document`, `document_count`, `admin`.

| Código | Error de `RwaRegistry` |
|---|---|
| 1 | `AssetAlreadyExists` |
| 2 | `AssetNotFound` |
| 3 | `Unauthorized` |
| 4 | `InvalidStatusTransition` |
| 6 | `DocumentNotFound` |
| 7 | `IssuerNotApproved` |
| 8 | `InvalidMaxSupply` |

### B. `rwa_token` (`PermissionedRwaToken`)
* **Ubicación:** `contracts/rwa_token/src/lib.rs`
* **Despliegue:** lo crea `RwaRegistry::create_asset`; un token por activo. Constructor: `(registry, asset_id, decimals, name, symbol, max_supply)`.
* **Sin admin propio:** los roles y el estado se leen de `RwaRegistry` en cada operación.
  * `mint(to, amount)`: firma el **emisor registrado** del activo, que debe seguir aprobado; activo `Active`; receptor autorizado; respeta `max_supply`.
  * `transfer(from, to, amount)`: firma `from`; activo `Active` (`Paused` → `AssetPaused`); emisor y receptor autorizados; wallet congelada → `WalletFrozen`.
  * `burn(from, amount)`: redención por el titular, permitida con el activo `Active` o `Redeemed`; bloqueada si está pausado o la wallet congelada.
  * Consultas: `balance`, `total_supply`, `max_supply`, `decimals`, `name`, `symbol`, `asset_id`, `registry`.
* Consulta al registro mediante una interfaz (`#[contractclient]`): su WASM no incluye ni exporta funciones del registro.
* El TTL del storage se extiende en cada operación para evitar el archivado de estado.

| Código | Error de `PermissionedRwaToken` |
|---|---|
| 1 | `ReceiverNotAuthorized` |
| 2 | `SenderNotAuthorized` |
| 3 | `WalletFrozen` |
| 4 | `AssetPaused` |
| 5 | `InsufficientBalance` |
| 6 | `AssetNotActive` |
| 8 | `NotInitialized` |
| 9 | `InvalidAmount` |
| 10 | `MaxSupplyExceeded` |
| 11 | `IssuerNotApproved` |

---

## 2. Contratos Desplegados en Stellar Testnet

| Contrato | Contract ID en Testnet | Explorador Público |
| :--- | :--- | :--- |
| **`RwaRegistry`** | `CBA2NU2QACTD5GGYIXAQXBDJTGUZDTLJ7RVU6JUHPHWTNL46JOKLHJPN` | [Ver en Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBA2NU2QACTD5GGYIXAQXBDJTGUZDTLJ7RVU6JUHPHWTNL46JOKLHJPN) |
| **Token de `FACT001`** | `CCIA5TNHXLMCQ6N34VVZAZBXKBEXIWFKUE4SWSFU2GWTL2AE6BPLACKR` | [Ver en Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCIA5TNHXLMCQ6N34VVZAZBXKBEXIWFKUE4SWSFU2GWTL2AE6BPLACKR) |

> Desplegado el 2026-10-09. WASM de tokens: `6e64793fc36948517f674d98b351395574f54348bf0d753735cc97ae39e75ddc`. Cada activo nuevo tiene su propio token (`get_token`).

> La configuración completa de red y cuentas fondeadas se encuentra en el archivo [contracts.json](../contracts.json).

---

## 3. Requisitos del Entorno Local

* **Rust:** 1.80+ (probado con `rustc 1.93.1` y `cargo`).
* **Target WASM:** `wasm32v1-none` (o `wasm32-unknown-unknown`).
  ```bash
  rustup target add wasm32v1-none
  ```
* **Stellar CLI:** 25.0+ (probado con `stellar 25.1.0`).
  ```bash
  stellar --version
  ```

---

## 4. Comandos de Desarrollo Local

### Ejecución de Pruebas Unitarias (Entorno Simulado en Rust)
Los contratos cuentan con tests unitarios que simulan el entorno de Soroban sin necesidad de conexión a internet o testnet:

```bash
# Desde la carpeta contracts/
cargo test --jobs 1   # requiere rwa_token.wasm compilado (ver abajo)
```

Los tests despliegan el token desde su WASM, así que hay que compilarlo antes. Desde la raíz:

```bash
npm run test:contracts
```

Casos cubiertos (18):
* Solo emisores aprobados crean activos; aprobación/revocación exige firma del admin; `create_asset` lo firma el emisor.
* Cada activo despliega su propio token; duplicados y `max_supply <= 0` rechazados.
* Oficial de compliance falso rechazado; autorizar, congelar y revocar wallets.
* Documentos con versión automática e inmutable; terceros no pueden añadir documentos.
* Máquina de estados (válidas, inválidas, valores fuera de rango); el admin solo puede pausar.
* Mint firmado por el emisor registrado; emisor revocado no puede emitir; tope `max_supply`.
* Transferencias permisionadas, `ReceiverNotAuthorized`, `SenderNotAuthorized`, `WalletFrozen` en mint/transfer/burn.
* Pausa vía estado del registro (mint, transfer y burn bloqueados) y redención con `burn` tras `Redeemed`.

### Compilación a WASM
Para compilar los contratos optimizados para la red Stellar:

```bash
# Desde la carpeta contracts/
cargo build --target wasm32v1-none --release --jobs 1
```

Los binarios resultantes se generan en:
* `contracts/target/wasm32v1-none/release/rwa_registry.wasm` (11.5 KB)
* `contracts/target/wasm32v1-none/release/rwa_token.wasm` (24.3 KB)

---

## 5. Scripts de Automatización en Testnet

Desde la raíz del repositorio, dispones de scripts ejecutables para gestionar todo el ciclo on-chain:

### A. Despliegue de Contratos
Compila los binarios, sube el WASM del token (`stellar contract upload`) y despliega `RwaRegistry` con el admin y el hash del WASM como argumentos del constructor. Actualiza `contracts.json`, `backend/contracts.json` y el `.env`:
```bash
npm run script:deploy
```

### B. Carga de Datos Semilla (Seed)
Fondea las identidades con Friendbot, el admin aprueba al emisor, el emisor registra la "Factura Comercial 001" (se despliega su token), vincula su documento, la activa, autoriza al emisor y a la Wallet A, y emite los tokens iniciales (`ASSETRA_MAX_SUPPLY`, por defecto 1000):
```bash
npm run script:seed
```

### Gestión de emisores (admin)
```bash
npm run script:issuer -- approve G...   # tras el KYB del emisor
npm run script:issuer -- revoke  G...
npm run script:issuer -- status  G...
```

### C. Demostración Completa (Demo)
Ejecuta el guion paso a paso de 9 etapas mostrando cada operación, su explicación técnica y las confirmaciones o reversiones on-chain:
```bash
npm run script:demo
```
