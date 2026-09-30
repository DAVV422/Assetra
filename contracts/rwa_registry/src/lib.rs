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
    pub compliance_officer: Address,
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
    /// Registra un nuevo activo asignando su emisor y oficial de cumplimiento autorizado.
    pub fn create_asset(
        e: Env,
        asset_id: Symbol,
        issuer: Address,
        compliance_officer: Address,
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
            compliance_officer,
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

    /// Asocia un documento verificable (hash SHA-256 y URI) al activo.
    pub fn add_document(
        e: Env,
        asset_id: Symbol,
        caller: Address,
        doc_hash: BytesN<32>,
        uri: String,
        version: u32,
    ) -> Result<(), RegistryError> {
        caller.require_auth();

        let key = DataKey::Asset(asset_id.clone());
        let asset: AssetData = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AssetNotFound)?;

        if caller != asset.issuer && caller != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
        }

        let doc_key = DataKey::Document(asset_id.clone(), version);
        let doc = DocumentRecord {
            doc_hash,
            uri,
            version,
            status: 0, // Current
        };

        e.storage().persistent().set(&doc_key, &doc);

        e.events().publish(
            (symbol_short!("doc_add"), asset_id),
            version,
        );

        Ok(())
    }

    /// Modifica el estado global del activo (Draft, Active, Paused, Redeemed).
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

        if asset.issuer != caller && asset.compliance_officer != caller {
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

    /// Autoriza una wallet para operar con el activo. Solo el Compliance Officer designado puede autorizar.
    pub fn authorize_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let asset_key = DataKey::Asset(asset_id.clone());
        let asset: AssetData = e
            .storage()
            .persistent()
            .get(&asset_key)
            .ok_or(RegistryError::AssetNotFound)?;

        // Control de Seguridad: Valida que quien firma sea el oficial legítimo registrado
        if compliance_officer != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
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

    /// Revoca la autorización de una wallet. Solo el Compliance Officer designado puede revocar.
    pub fn revoke_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let asset_key = DataKey::Asset(asset_id.clone());
        let asset: AssetData = e
            .storage()
            .persistent()
            .get(&asset_key)
            .ok_or(RegistryError::AssetNotFound)?;

        if compliance_officer != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
        }

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

    /// Aplica suspensión cautelar (congelamiento) a una wallet.
    pub fn freeze_wallet(
        e: Env,
        asset_id: Symbol,
        compliance_officer: Address,
        wallet: Address,
    ) -> Result<(), RegistryError> {
        compliance_officer.require_auth();

        let asset_key = DataKey::Asset(asset_id.clone());
        let asset: AssetData = e
            .storage()
            .persistent()
            .get(&asset_key)
            .ok_or(RegistryError::AssetNotFound)?;

        if compliance_officer != asset.compliance_officer {
            return Err(RegistryError::Unauthorized);
        }

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

    /// Consulta si una wallet está autorizada para operar (Fail-closed design).
    pub fn is_authorized(e: Env, asset_id: Symbol, wallet: Address) -> bool {
        let perm_key = DataKey::WalletPerm(asset_id, wallet);
        let status: u32 = e
            .storage()
            .persistent()
            .get(&perm_key)
            .unwrap_or(WalletStatus::Pending as u32);

        status == (WalletStatus::Authorized as u32)
    }

    /// Obtiene los datos completos del activo.
    pub fn get_asset(e: Env, asset_id: Symbol) -> Result<AssetData, RegistryError> {
        let key = DataKey::Asset(asset_id);
        e.storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AssetNotFound)
    }

    /// Consulta un documento específico por versión.
    pub fn get_document(e: Env, asset_id: Symbol, version: u32) -> Result<DocumentRecord, RegistryError> {
        let key = DataKey::Document(asset_id, version);
        e.storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AssetNotFound)
    }
}

#[cfg(test)]
mod test;
