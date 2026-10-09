#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, BytesN, Env, IntoVal,
    String, Symbol, Val,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AssetAlreadyExists = 1,
    AssetNotFound = 2,
    Unauthorized = 3,
    InvalidStatusTransition = 4,
    DocumentNotFound = 6,
    IssuerNotApproved = 7,
    InvalidMaxSupply = 8,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetStatus {
    Draft = 0,
    Active = 1,
    Paused = 2,
    Redeemed = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum WalletStatus {
    Pending = 0,
    Authorized = 1,
    Revoked = 2,
    Frozen = 3,
}

/// Datos on-chain de un activo. `PermissionedRwaToken` mantiene una copia espejo de esta estructura:
/// si se modifica, hay que actualizar también `rwa_token`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetData {
    pub issuer: Address,
    pub compliance_officer: Address,
    pub token: Address,
    pub asset_type: Symbol,
    pub metadata_uri: String,
    pub main_hash: BytesN<32>,
    pub due_date: u64,
    pub status: u32,
}

/// Parámetros de alta de un activo y de su token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewAsset {
    pub asset_type: Symbol,
    pub metadata_uri: String,
    pub main_hash: BytesN<32>,
    pub due_date: u64,
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
    pub max_supply: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentRecord {
    pub doc_hash: BytesN<32>,
    pub uri: String,
    pub version: u32,
    pub status: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    TokenWasm,
    Issuer(Address),
    Asset(Symbol),
    Document(Symbol, u32),
    DocCount(Symbol),
    WalletPerm(Symbol, Address),
}

// ~5 s por ledger: 17_280 ledgers ≈ 1 día.
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const TTL_EXTEND_TO: u32 = 60 * DAY_IN_LEDGERS;

fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn bump_persistent<K: IntoVal<Env, Val>>(e: &Env, key: &K) {
    e.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn read_admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Admin).unwrap()
}

fn load_asset(e: &Env, asset_id: &Symbol) -> Result<AssetData, RegistryError> {
    let key = DataKey::Asset(asset_id.clone());
    let asset: AssetData = e
        .storage()
        .persistent()
        .get(&key)
        .ok_or(RegistryError::AssetNotFound)?;
    bump_persistent(e, &key);
    Ok(asset)
}

fn save_asset(e: &Env, asset_id: &Symbol, asset: &AssetData) {
    let key = DataKey::Asset(asset_id.clone());
    e.storage().persistent().set(&key, asset);
    bump_persistent(e, &key);
}

/// Transiciones permitidas: Draft → Active, Active ⇄ Paused, Active/Paused → Redeemed (terminal).
fn is_valid_transition(from: u32, to: u32) -> bool {
    const DRAFT: u32 = AssetStatus::Draft as u32;
    const ACTIVE: u32 = AssetStatus::Active as u32;
    const PAUSED: u32 = AssetStatus::Paused as u32;
    const REDEEMED: u32 = AssetStatus::Redeemed as u32;
    matches!(
        (from, to),
        (DRAFT, ACTIVE) | (ACTIVE, PAUSED) | (PAUSED, ACTIVE) | (ACTIVE, REDEEMED) | (PAUSED, REDEEMED)
    )
}

#[contract]
pub struct RwaRegistry;

#[contractimpl]
impl RwaRegistry {
    /// Se ejecuta atómicamente en el despliegue: fija el admin de la plataforma y el WASM de los tokens.
    pub fn __constructor(e: Env, admin: Address, token_wasm_hash: BytesN<32>) {
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::TokenWasm, &token_wasm_hash);
        bump_instance(&e);
    }

    // ------------------------------------------------------------------
    // Administración de la plataforma
    // ------------------------------------------------------------------

    pub fn admin(e: Env) -> Address {
        read_admin(&e)
    }

    /// Transfiere el rol de administrador (p. ej. rotación de claves).
    pub fn set_admin(e: Env, new_admin: Address) {
        let admin = read_admin(&e);
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&e);
        e.events().publish((symbol_short!("admin"), admin), new_admin);
    }

    /// Cambia el WASM con el que se despliegan los tokens de los activos nuevos.
    pub fn set_token_wasm(e: Env, token_wasm_hash: BytesN<32>) {
        read_admin(&e).require_auth();
        e.storage().instance().set(&DataKey::TokenWasm, &token_wasm_hash);
        bump_instance(&e);
    }

    /// Aprueba a un emisor (tras su KYB fuera de la cadena) para que pueda registrar activos.
    pub fn approve_issuer(e: Env, issuer: Address) {
        Self::set_issuer(&e, issuer, true, symbol_short!("iss_ok"));
    }

    /// Retira la aprobación: el emisor ya no puede crear activos ni emitir tokens.
    pub fn revoke_issuer(e: Env, issuer: Address) {
        Self::set_issuer(&e, issuer, false, symbol_short!("iss_rev"));
    }

    pub fn is_approved_issuer(e: Env, issuer: Address) -> bool {
        let key = DataKey::Issuer(issuer);
        match e.storage().persistent().get::<_, bool>(&key) {
            Some(approved) => {
                bump_persistent(&e, &key);
                approved
            }
            None => false,
        }
    }

    // ------------------------------------------------------------------
    // Ciclo de vida del activo
    // ------------------------------------------------------------------

    /// Registra un activo y despliega su token permisionado en la misma transacción.
    /// Solo un emisor aprobado por el admin, firmando él mismo. Devuelve la dirección del token.
    pub fn create_asset(
        e: Env,
        asset_id: Symbol,
        issuer: Address,
        compliance_officer: Address,
        params: NewAsset,
    ) -> Result<Address, RegistryError> {
        issuer.require_auth();
        bump_instance(&e);

        if !Self::is_approved_issuer(e.clone(), issuer.clone()) {
            return Err(RegistryError::IssuerNotApproved);
        }
        if params.max_supply <= 0 {
            return Err(RegistryError::InvalidMaxSupply);
        }

        let key = DataKey::Asset(asset_id.clone());
        if e.storage().persistent().has(&key) {
            return Err(RegistryError::AssetAlreadyExists);
        }

        // Dirección del token determinista a partir del asset_id
        let salt: BytesN<32> = e.crypto().sha256(&asset_id.clone().to_xdr(&e)).into();
        let wasm_hash: BytesN<32> = e.storage().instance().get(&DataKey::TokenWasm).unwrap();
        let token = e.deployer().with_current_contract(salt).deploy_v2(
            wasm_hash,
            (
                e.current_contract_address(),
                asset_id.clone(),
                params.decimals,
                params.name,
                params.symbol,
                params.max_supply,
            ),
        );

        let asset = AssetData {
            issuer: issuer.clone(),
            compliance_officer,
            token: token.clone(),
            asset_type: params.asset_type,
            metadata_uri: params.metadata_uri,
            main_hash: params.main_hash,
            due_date: params.due_date,
            status: AssetStatus::Draft as u32,
        };
        save_asset(&e, &asset_id, &asset);

        e.events().publish((symbol_short!("created"), asset_id, issuer), token.clone());

        Ok(token)
    }

    /// Asocia un documento verificable (hash SHA-256 y URI) al activo. La versión se asigna
    /// automáticamente (1, 2, 3…) y cada versión es inmutable. Devuelve la versión asignada.
    pub fn add_document(
        e: Env,
        asset_id: Symbol,
        caller: Address,
        doc_hash: BytesN<32>,
        uri: String,
    ) -> Result<u32, RegistryError> {
        caller.require_auth();

        let asset = load_asset(&e, &asset_id)?;
        if caller != asset.issuer && caller != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
        }

        let count_key = DataKey::DocCount(asset_id.clone());
        let version: u32 = e.storage().persistent().get::<_, u32>(&count_key).unwrap_or(0) + 1;
        e.storage().persistent().set(&count_key, &version);
        bump_persistent(&e, &count_key);

        let doc_key = DataKey::Document(asset_id.clone(), version);
        let doc = DocumentRecord { doc_hash, uri, version, status: 0 };
        e.storage().persistent().set(&doc_key, &doc);
        bump_persistent(&e, &doc_key);

        e.events().publish((symbol_short!("doc_add"), asset_id), version);

        Ok(version)
    }

    /// Modifica el estado del activo respetando la máquina de estados.
    /// Emisor y compliance pueden hacer cualquier transición válida; el admin de la plataforma
    /// solo puede pausar (freno de emergencia).
    pub fn set_asset_status(
        e: Env,
        asset_id: Symbol,
        caller: Address,
        new_status: u32,
    ) -> Result<(), RegistryError> {
        caller.require_auth();

        let mut asset = load_asset(&e, &asset_id)?;
        let is_owner = caller == asset.issuer || caller == asset.compliance_officer;
        let is_admin_pause = caller == read_admin(&e) && new_status == AssetStatus::Paused as u32;
        if !is_owner && !is_admin_pause {
            return Err(RegistryError::Unauthorized);
        }

        if !is_valid_transition(asset.status, new_status) {
            return Err(RegistryError::InvalidStatusTransition);
        }

        asset.status = new_status;
        save_asset(&e, &asset_id, &asset);

        e.events().publish((symbol_short!("status"), asset_id), new_status);

        Ok(())
    }

    // ------------------------------------------------------------------
    // Compliance (whitelist por activo)
    // ------------------------------------------------------------------

    /// Autoriza una wallet para operar con el activo. Solo el Compliance Officer designado.
    pub fn authorize_wallet(e: Env, asset_id: Symbol, compliance_officer: Address, wallet: Address) -> Result<(), RegistryError> {
        Self::set_wallet_status(&e, asset_id, compliance_officer, wallet, WalletStatus::Authorized, symbol_short!("auth"))
    }

    /// Revoca la autorización de una wallet. Solo el Compliance Officer designado.
    pub fn revoke_wallet(e: Env, asset_id: Symbol, compliance_officer: Address, wallet: Address) -> Result<(), RegistryError> {
        Self::set_wallet_status(&e, asset_id, compliance_officer, wallet, WalletStatus::Revoked, symbol_short!("revoked"))
    }

    /// Aplica suspensión cautelar (congelamiento) a una wallet.
    pub fn freeze_wallet(e: Env, asset_id: Symbol, compliance_officer: Address, wallet: Address) -> Result<(), RegistryError> {
        Self::set_wallet_status(&e, asset_id, compliance_officer, wallet, WalletStatus::Frozen, symbol_short!("frozen"))
    }

    /// Estado de permisos de una wallet (`WalletStatus` como u32). Sin registro → Pending.
    pub fn wallet_status(e: Env, asset_id: Symbol, wallet: Address) -> u32 {
        let perm_key = DataKey::WalletPerm(asset_id, wallet);
        match e.storage().persistent().get::<_, u32>(&perm_key) {
            Some(status) => {
                bump_persistent(&e, &perm_key);
                status
            }
            None => WalletStatus::Pending as u32,
        }
    }

    /// Consulta si una wallet está autorizada para operar (Fail-closed design).
    pub fn is_authorized(e: Env, asset_id: Symbol, wallet: Address) -> bool {
        Self::wallet_status(e, asset_id, wallet) == (WalletStatus::Authorized as u32)
    }

    // ------------------------------------------------------------------
    // Consultas
    // ------------------------------------------------------------------

    pub fn get_asset(e: Env, asset_id: Symbol) -> Result<AssetData, RegistryError> {
        load_asset(&e, &asset_id)
    }

    pub fn get_token(e: Env, asset_id: Symbol) -> Result<Address, RegistryError> {
        Ok(load_asset(&e, &asset_id)?.token)
    }

    pub fn document_count(e: Env, asset_id: Symbol) -> u32 {
        e.storage().persistent().get(&DataKey::DocCount(asset_id)).unwrap_or(0)
    }

    pub fn get_document(e: Env, asset_id: Symbol, version: u32) -> Result<DocumentRecord, RegistryError> {
        let key = DataKey::Document(asset_id, version);
        let doc = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::DocumentNotFound)?;
        bump_persistent(&e, &key);
        Ok(doc)
    }
}

impl RwaRegistry {
    fn set_issuer(e: &Env, issuer: Address, approved: bool, topic: Symbol) {
        read_admin(e).require_auth();
        let key = DataKey::Issuer(issuer.clone());
        e.storage().persistent().set(&key, &approved);
        bump_persistent(e, &key);
        bump_instance(e);
        e.events().publish((topic, issuer), approved);
    }

    fn set_wallet_status(
        e: &Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
        status: WalletStatus,
        topic: Symbol,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        // Control de Seguridad: Valida que quien firma sea el oficial legítimo registrado
        let asset = load_asset(e, &asset_id)?;
        if compliance_officer != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
        }

        let perm_key = DataKey::WalletPerm(asset_id.clone(), wallet.clone());
        e.storage().persistent().set(&perm_key, &(status as u32));
        bump_persistent(e, &perm_key);

        e.events().publish((topic, asset_id, wallet), status as u32);

        Ok(())
    }
}

#[cfg(test)]
mod test;
