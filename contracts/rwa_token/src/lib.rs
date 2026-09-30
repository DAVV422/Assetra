#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol,
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
    AlreadyInitialized = 7,
    NotInitialized = 8,
    InvalidAmount = 9,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Registry,
    AssetId,
    Decimals,
    Name,
    Symbol,
    TotalSupply,
    Balance(Address),
    IsPaused,
}

#[contract]
pub struct PermissionedRwaToken;

#[contractimpl]
impl PermissionedRwaToken {
    pub fn initialize(
        e: Env,
        admin: Address,
        registry: Address,
        asset_id: Symbol,
        decimals: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(TokenError::AlreadyInitialized);
        }

        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Registry, &registry);
        e.storage().instance().set(&DataKey::AssetId, &asset_id);
        e.storage().instance().set(&DataKey::Decimals, &decimals);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
        e.storage().instance().set(&DataKey::TotalSupply, &0i128);
        e.storage().instance().set(&DataKey::IsPaused, &false);

        Ok(())
    }

    pub fn mint(e: Env, admin: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        admin.require_auth();

        // Control de Seguridad 1: Monto positivo
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let stored_admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;

        if admin != stored_admin {
            return Err(TokenError::SenderNotAuthorized);
        }

        let is_paused: bool = e.storage().instance().get(&DataKey::IsPaused).unwrap_or(false);
        if is_paused {
            return Err(TokenError::AssetPaused);
        }

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

        let registry_client = rwa_registry::RwaRegistryClient::new(&e, &registry_addr);

        // Control de Seguridad 2: El activo debe estar en estado Active (1) en RwaRegistry
        let asset = registry_client.get_asset(&asset_id);
        if asset.status != (rwa_registry::AssetStatus::Active as u32) {
            return Err(TokenError::AssetNotActive);
        }

        // Control de Seguridad 3: El receptor debe estar en la whitelist
        if !registry_client.is_authorized(&asset_id, &to) {
            return Err(TokenError::ReceiverNotAuthorized);
        }

        // Actualizar balance
        let balance_key = DataKey::Balance(to.clone());
        let current_balance: i128 = e.storage().persistent().get(&balance_key).unwrap_or(0);
        e.storage().persistent().set(&balance_key, &(current_balance + amount));

        // Actualizar total supply
        let total_supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        e.storage().instance().set(&DataKey::TotalSupply, &(total_supply + amount));

        e.events().publish((symbol_short!("mint"), to), amount);

        Ok(())
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        // Control de Seguridad 1: Monto positivo
        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let is_paused: bool = e.storage().instance().get(&DataKey::IsPaused).unwrap_or(false);
        if is_paused {
            return Err(TokenError::AssetPaused);
        }

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

        let registry_client = rwa_registry::RwaRegistryClient::new(&e, &registry_addr);

        // Control de Seguridad 2: El activo debe estar en estado Active (1) en RwaRegistry
        let asset = registry_client.get_asset(&asset_id);
        if asset.status != (rwa_registry::AssetStatus::Active as u32) {
            return Err(TokenError::AssetNotActive);
        }

        // Control de Seguridad 3: Validación estricta de Compliance (Emisor y Receptor)
        if !registry_client.is_authorized(&asset_id, &from) {
            return Err(TokenError::SenderNotAuthorized);
        }

        if !registry_client.is_authorized(&asset_id, &to) {
            return Err(TokenError::ReceiverNotAuthorized);
        }

        // Control de Seguridad 4: Validar saldo suficiente
        let from_key = DataKey::Balance(from.clone());
        let from_balance: i128 = e.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        let to_key = DataKey::Balance(to.clone());
        let to_balance: i128 = e.storage().persistent().get(&to_key).unwrap_or(0);

        e.storage().persistent().set(&from_key, &(from_balance - amount));
        e.storage().persistent().set(&to_key, &(to_balance + amount));

        e.events().publish((symbol_short!("transfer"), from, to), amount);

        Ok(())
    }

    pub fn burn(e: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        let from_key = DataKey::Balance(from.clone());
        let from_balance: i128 = e.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        e.storage().persistent().set(&from_key, &(from_balance - amount));

        let total_supply: i128 = e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        e.storage().instance().set(&DataKey::TotalSupply, &(total_supply - amount));

        e.events().publish((symbol_short!("burn"), from), amount);

        Ok(())
    }

    pub fn pause(e: Env, admin: Address) -> Result<(), TokenError> {
        admin.require_auth();
        e.storage().instance().set(&DataKey::IsPaused, &true);
        e.events().publish((symbol_short!("paused"), admin), true);
        Ok(())
    }

    pub fn unpause(e: Env, admin: Address) -> Result<(), TokenError> {
        admin.require_auth();
        e.storage().instance().set(&DataKey::IsPaused, &false);
        e.events().publish((symbol_short!("unpaused"), admin), false);
        Ok(())
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage().persistent().get(&DataKey::Balance(id)).unwrap_or(0)
    }

    pub fn total_supply(e: Env) -> i128 {
        e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
