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

### A. `rwa_registry` (Registro y Compliance)
* **Ubicación:** `contracts/rwa_registry/src/lib.rs`
* **Propósito:** Actúa como la notaría digital y catálogo centralizado de cumplimiento.
* **Funciones Clave:**
  * `create_asset`: Registra el activo en estado `Draft` asignando su emisor y oficial de cumplimiento legítimo.
  * `add_document`: Vincula expedientes de soporte mediante su Hash criptográfico SHA-256 y versión.
  * `authorize_wallet`: Habilita una wallet para operar (`Authorized`).
  * `revoke_wallet`: Retira el permiso a una wallet (`Revoked`).
  * `freeze_wallet`: Aplica suspensión cautelar de emergencia (`Frozen`).
  * `set_asset_status`: Cambia el ciclo de vida del activo (`Draft` $\rightarrow$ `Active` $\leftrightarrow$ `Paused` $\rightarrow$ `Redeemed`).
  * `is_authorized`: Consulta de solo lectura (Fail-closed design) para verificar si una wallet puede transaccionar.

### B. `rwa_token` (`PermissionedRwaToken`)
* **Ubicación:** `contracts/rwa_token/src/lib.rs`
* **Propósito:** Representación digital y token transferible fraccionado (ej. 1,000 unidades de la Factura 001).
* **Control Permisionado:** En cada llamada a `transfer`, consulta de forma síncrona a `RwaRegistry`. Si el receptor no está en la Whitelist o está congelado, la transacción **aborta obligatoriamente** con el error tipado:
  ```rust
  TokenError::ReceiverNotAuthorized // Contract Error #1
  ```
* **Otras Funciones:** `mint` (solo en estado `Active`), `burn` (redención), `pause` y `unpause` (freno de emergencia).

---

## 2. Contratos Desplegados en Stellar Testnet

| Contrato | Contract ID en Testnet | Explorador Público |
| :--- | :--- | :--- |
| **`RwaRegistry`** | `CAC57CATCF5DZYLRW6XEZ4DP367V25D24KO6V37U4EEQWJO3CTVV7N5F` | [Ver en Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAC57CATCF5DZYLRW6XEZ4DP367V25D24KO6V37U4EEQWJO3CTVV7N5F) |
| **`PermissionedRwaToken`** | `CBACUWCFDNO7BU7UCI7G4U45Y5WDNXCAGVI4AFQO5ZBMBHMRFC67GLKG` | [Ver en Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBACUWCFDNO7BU7UCI7G4U45Y5WDNXCAGVI4AFQO5ZBMBHMRFC67GLKG) |

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
cargo test --jobs 1
```

Casos cubiertos en los tests:
* Creación de activo y rechazo a oficiales de cumplimiento no autorizados.
* Vinculación de documentos con hash SHA-256.
* Rechazo de emisión en estado `Draft`.
* Rechazo de transferencias con montos `<= 0` (`InvalidAmount #9`).
* Transferencia exitosa entre wallets autorizadas.
* **Bloqueo on-chain hacia wallet no autorizada (`ReceiverNotAuthorized #1`).**
* Bloqueo por congelamiento cautelar (`WalletFrozen`).
* Freno de emergencia (`AssetPaused #4`).
* Redención y quema de tokens (`burn`).

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
Compila los binarios, los sube a Testnet, inicializa el token y actualiza `contracts.json` y el `.env`:
```bash
npm run script:deploy
```

### B. Carga de Datos Semilla (Seed)
Fondea las identidades con Friendbot, registra la "Factura Comercial 001", vincula su hash, autoriza la Wallet A y emite 1,000 tokens iniciales:
```bash
npm run script:seed
```

### C. Demostración Completa (Demo)
Ejecuta el guion paso a paso de 9 etapas mostrando cada operación, su explicación técnica y las confirmaciones o reversiones on-chain:
```bash
npm run script:demo
```
