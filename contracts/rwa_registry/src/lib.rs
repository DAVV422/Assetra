#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AssetAlreadyExists = 1,
    AssetNotFound = 2,
    Unauthorized = 3,
    InvalidStatusTransition = 4,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetData {
    pub issuer: Address,
    pub asset_type: Symbol,
    pub metadata_uri: String,
    pub main_hash: BytesN<32>,
    pub due_date: u64,
    pub status: u32,
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
    Asset(Symbol),
    Document(Symbol, u32),
    WalletPerm(Symbol, Address),
}

#[contract]
pub struct RwaRegistry;

#[contractimpl]
impl RwaRegistry {
    pub fn create_asset(
        e: Env,
        asset_id: Symbol,
        issuer: Address,
        asset_type: Symbol,
        metadata_uri: String,
        main_hash: BytesN<32>,
        due_date: u64,
    ) -> Result<(), RegistryError> {
        issuer.require_auth();

        let key = DataKey::Asset(asset_id.clone());
        if e.storage().persistent().has(&key) {
            return Err(RegistryError::AssetAlreadyExists);
        }

        let asset = AssetData {
            issuer: issuer.clone(),
            asset_type,
            metadata_uri,
            main_hash,
            due_date,
            status: AssetStatus::Draft as u32,
        };

        e.storage().persistent().set(&key, &asset);

        e.events().publish(
            (symbol_short!("created"), asset_id, issuer),
            asset.status,
        );

        Ok(())
    }

    pub fn set_asset_status(
        e: Env,
        asset_id: Symbol,
        caller: Address,
        new_status: u32,
    ) -> Result<(), RegistryError> {
        caller.require_auth();

        let key = DataKey::Asset(asset_id.clone());
        let mut asset: AssetData = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AssetNotFound)?;

        if asset.issuer != caller {
            return Err(RegistryError::Unauthorized);
        }

        asset.status = new_status;
        e.storage().persistent().set(&key, &asset);

        e.events().publish(
            (symbol_short!("status"), asset_id),
            new_status,
        );

        Ok(())
    }

    pub fn authorize_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let asset_key = DataKey::Asset(asset_id.clone());
        if !e.storage().persistent().has(&asset_key) {
            return Err(RegistryError::AssetNotFound);
        }

        let perm_key = DataKey::WalletPerm(asset_id.clone(), wallet.clone());
        e.storage()
            .persistent()
            .set(&perm_key, &(WalletStatus::Authorized as u32));

        e.events().publish(
            (symbol_short!("auth"), asset_id, wallet),
            WalletStatus::Authorized as u32,
        );

        Ok(())
    }

    pub fn revoke_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let perm_key = DataKey::WalletPerm(asset_id.clone(), wallet.clone());
        e.storage()
            .persistent()
            .set(&perm_key, &(WalletStatus::Revoked as u32));

        e.events().publish(
            (symbol_short!("revoked"), asset_id, wallet),
            WalletStatus::Revoked as u32,
        );

        Ok(())
    }

    pub fn freeze_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let perm_key = DataKey::WalletPerm(asset_id.clone(), wallet.clone());
        e.storage()
            .persistent()
            .set(&perm_key, &(WalletStatus::Frozen as u32));

        e.events().publish(
            (symbol_short!("frozen"), asset_id, wallet),
            WalletStatus::Frozen as u32,
        );

        Ok(())
    }

    pub fn is_authorized(e: Env, asset_id: Symbol, wallet: Address) -> bool {
        let perm_key = DataKey::WalletPerm(asset_id, wallet);
        let status: u32 = e
            .storage()
            .persistent()
            .get(&perm_key)
            .unwrap_or(WalletStatus::Pending as u32);

        status == (WalletStatus::Authorized as u32)
    }

    pub fn get_asset(e: Env, asset_id: Symbol) -> Result<AssetData, RegistryError> {
        let key = DataKey::Asset(asset_id);
        e.storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AssetNotFound)
    }
}

#[cfg(test)]
mod test;
