#![no_std]

//! Token permisionado de un activo RWA. Lo despliega `RwaRegistry` al registrar el activo.
//! No tiene administrador propio: los roles (emisor, compliance) y el estado del activo se
//! leen siempre del registro, que es la única fuente de verdad de permisos.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    ReceiverNotAuthorized = 1,
    SenderNotAuthorized = 2,
    WalletFrozen = 3,
    AssetPaused = 4,
    InsufficientBalance = 5,
    AssetNotActive = 6,
    NotInitialized = 8,
    InvalidAmount = 9,
    MaxSupplyExceeded = 10,
    IssuerNotApproved = 11,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Registry,
    AssetId,
    Decimals,
    Name,
    Symbol,
    TotalSupply,
    MaxSupply,
    Balance(Address),
}

// Valores espejo de `rwa_registry`. Se declaran aquí (en lugar de depender del crate)
// para que el WASM del token no incluya ni exporte las funciones del registro.
const ASSET_ACTIVE: u32 = 1;
const ASSET_PAUSED: u32 = 2;
const ASSET_REDEEMED: u32 = 3;
const WALLET_AUTHORIZED: u32 = 1;
const WALLET_FROZEN: u32 = 3;

/// Copia espejo de `rwa_registry::AssetData` (debe coincidir campo a campo).
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

#[allow(dead_code)]
#[contractclient(name = "RegistryClient")]
trait RegistryInterface {
    fn get_asset(e: Env, asset_id: Symbol) -> AssetData;
    fn wallet_status(e: Env, asset_id: Symbol, wallet: Address) -> u32;
    fn is_approved_issuer(e: Env, issuer: Address) -> bool;
}

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const TTL_EXTEND_TO: u32 = 60 * DAY_IN_LEDGERS;

fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn read_balance(e: &Env, id: &Address) -> i128 {
    let key = DataKey::Balance(id.clone());
    match e.storage().persistent().get::<_, i128>(&key) {
        Some(balance) => {
            e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            balance
        }
        None => 0,
    }
}

fn write_balance(e: &Env, id: &Address, amount: i128) {
    let key = DataKey::Balance(id.clone());
    e.storage().persistent().set(&key, &amount);
    e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn registry(e: &Env) -> Result<(RegistryClient<'_>, Symbol), TokenError> {
    let registry_addr: Address = e
        .storage()
        .instance()
        .get(&DataKey::Registry)
        .ok_or(TokenError::NotInitialized)?;
    let asset_id: Symbol = e
        .storage()
        .instance()
        .get(&DataKey::AssetId)
        .ok_or(TokenError::NotInitialized)?;
    Ok((RegistryClient::new(e, &registry_addr), asset_id))
}

fn require_active(asset: &AssetData) -> Result<(), TokenError> {
    match asset.status {
        ASSET_ACTIVE => Ok(()),
        ASSET_PAUSED => Err(TokenError::AssetPaused),
        _ => Err(TokenError::AssetNotActive),
    }
}

/// Valida el estado de compliance de una wallet; `not_authorized` es el error si no está autorizada.
fn require_wallet(
    registry: &RegistryClient,
    asset_id: &Symbol,
    wallet: &Address,
    not_authorized: TokenError,
) -> Result<(), TokenError> {
    match registry.wallet_status(asset_id, wallet) {
        WALLET_AUTHORIZED => Ok(()),
        WALLET_FROZEN => Err(TokenError::WalletFrozen),
        _ => Err(not_authorized),
    }
}

#[contract]
pub struct PermissionedRwaToken;

#[contractimpl]
impl PermissionedRwaToken {
    /// Lo invoca `RwaRegistry::create_asset` en la misma transacción del despliegue.
    pub fn __constructor(
        e: Env,
        registry: Address,
        asset_id: Symbol,
        decimals: u32,
        name: String,
        symbol: String,
        max_supply: i128,
    ) {
        if max_supply <= 0 {
            panic_with_error!(&e, TokenError::InvalidAmount);
        }

        e.storage().instance().set(&DataKey::Registry, &registry);
        e.storage().instance().set(&DataKey::AssetId, &asset_id);
        e.storage().instance().set(&DataKey::Decimals, &decimals);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::TotalSupply, &0i128);
        e.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        bump_instance(&e);
    }

    /// Emite tokens. Firma el emisor del activo registrado en `RwaRegistry`, que debe seguir aprobado.
    pub fn mint(e: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        // Control de Seguridad 1: Monto positivo
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        bump_instance(&e);

        let (registry, asset_id) = registry(&e)?;
        let asset = registry.get_asset(&asset_id);

        // Control de Seguridad 2: Solo el emisor del activo, y mientras siga aprobado por la plataforma
        asset.issuer.require_auth();
        if !registry.is_approved_issuer(&asset.issuer) {
            return Err(TokenError::IssuerNotApproved);
        }

        // Control de Seguridad 3: El activo debe estar en estado Active
        require_active(&asset)?;

        // Control de Seguridad 4: El receptor debe estar en la whitelist
        require_wallet(&registry, &asset_id, &to, TokenError::ReceiverNotAuthorized)?;

        // Control de Seguridad 5: No superar el suministro máximo
        let total_supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let max_supply: i128 = e.storage().instance().get(&DataKey::MaxSupply).ok_or(TokenError::NotInitialized)?;
        let new_supply = total_supply.checked_add(amount).ok_or(TokenError::MaxSupplyExceeded)?;
        if new_supply > max_supply {
            return Err(TokenError::MaxSupplyExceeded);
        }

        write_balance(&e, &to, read_balance(&e, &to) + amount);
        e.storage().instance().set(&DataKey::TotalSupply, &new_supply);

        e.events().publish((symbol_short!("mint"), to), amount);

        Ok(())
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        // Control de Seguridad 1: Monto positivo
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        bump_instance(&e);

        // Control de Seguridad 2: El activo debe estar en estado Active (Paused bloquea)
        let (registry, asset_id) = registry(&e)?;
        require_active(&registry.get_asset(&asset_id))?;

        // Control de Seguridad 3: Validación estricta de Compliance (Emisor y Receptor)
        require_wallet(&registry, &asset_id, &from, TokenError::SenderNotAuthorized)?;
        require_wallet(&registry, &asset_id, &to, TokenError::ReceiverNotAuthorized)?;

        // Control de Seguridad 4: Validar saldo suficiente
        let from_balance = read_balance(&e, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        write_balance(&e, &from, from_balance - amount);
        write_balance(&e, &to, read_balance(&e, &to) + amount);

        e.events().publish((symbol_short!("transfer"), from, to), amount);

        Ok(())
    }

    /// Quema tokens del titular (redención). Permitido con el activo Active o Redeemed;
    /// bloqueado si está en Draft/Paused o si la wallet está congelada.
    pub fn burn(e: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }
        bump_instance(&e);

        let (registry, asset_id) = registry(&e)?;
        let asset = registry.get_asset(&asset_id);
        if asset.status != ASSET_REDEEMED {
            require_active(&asset)?;
        }
        if registry.wallet_status(&asset_id, &from) == WALLET_FROZEN {
            return Err(TokenError::WalletFrozen);
        }

        let from_balance = read_balance(&e, &from);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        write_balance(&e, &from, from_balance - amount);

        let total_supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        e.storage().instance().set(&DataKey::TotalSupply, &(total_supply - amount));

        e.events().publish((symbol_short!("burn"), from), amount);

        Ok(())
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        read_balance(&e, &id)
    }

    pub fn total_supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn max_supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0)
    }

    pub fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap_or(0)
    }

    pub fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn asset_id(e: Env) -> Symbol {
        e.storage().instance().get(&DataKey::AssetId).unwrap()
    }

    pub fn registry(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Registry).unwrap()
    }
}

#[cfg(test)]
mod test;
