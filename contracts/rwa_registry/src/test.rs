#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, symbol_short, BytesN, Env};

// `create_asset` despliega el token desde su WASM: compilar antes con
// `cargo build --target wasm32v1-none --release -p rwa-token` (o `npm run test:contracts`).
const TOKEN_WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/rwa_token.wasm");

struct Setup<'a> {
    env: Env,
    client: RwaRegistryClient<'a>,
    admin: Address,
    issuer: Address,
    compliance: Address,
    asset_id: Symbol,
}

fn new_asset(env: &Env, max_supply: i128) -> NewAsset {
    NewAsset {
        asset_type: symbol_short!("invoice"),
        metadata_uri: String::from_str(env, "https://assetra.io/assets/inv001.json"),
        main_hash: BytesN::from_array(env, &[1u8; 32]),
        due_date: 1770000000u64,
        name: String::from_str(env, "Factura 001"),
        symbol: String::from_str(env, "INV001"),
        decimals: 0,
        max_supply,
    }
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let wasm_hash = env.deployer().upload_contract_wasm(TOKEN_WASM);
    let contract_id = env.register(RwaRegistry, (&admin, &wasm_hash));
    let client = RwaRegistryClient::new(&env, &contract_id);

    let issuer = Address::generate(&env);
    let compliance = Address::generate(&env);
    let asset_id = symbol_short!("INV001");

    client.approve_issuer(&issuer);
    client.create_asset(&asset_id, &issuer, &compliance, &new_asset(&env, 1_000));

    Setup { env, client, admin, issuer, compliance, asset_id }
}

#[test]
fn test_create_and_authorize_asset() {
    let s = setup();
    let env = &s.env;
    let client = &s.client;
    let fake_compliance = Address::generate(env);
    let wallet_a = Address::generate(env);
    let wallet_b = Address::generate(env);

    // 1. El activo inicia en Draft con su emisor, oficial de cumplimiento y token desplegado
    let asset = client.get_asset(&s.asset_id);
    assert_eq!(asset.status, AssetStatus::Draft as u32);
    assert_eq!(asset.issuer, s.issuer);
    assert_eq!(asset.compliance_officer, s.compliance);
    assert_eq!(client.get_token(&s.asset_id), asset.token);

    // 2. Un falso oficial de cumplimiento debe ser rechazado
    let unauthorized_result = client.try_authorize_wallet(&s.asset_id, &fake_compliance, &wallet_a);
    assert_eq!(unauthorized_result, Err(Ok(RegistryError::Unauthorized)));

    // 3. Activar activo
    client.set_asset_status(&s.asset_id, &s.issuer, &(AssetStatus::Active as u32));
    assert_eq!(client.get_asset(&s.asset_id).status, AssetStatus::Active as u32);

    // 4. El oficial legítimo autoriza a Wallet A
    assert!(!client.is_authorized(&s.asset_id, &wallet_a));
    client.authorize_wallet(&s.asset_id, &s.compliance, &wallet_a);
    assert!(client.is_authorized(&s.asset_id, &wallet_a));

    // 5. Wallet B permanece no autorizada (Pending)
    assert_eq!(client.wallet_status(&s.asset_id, &wallet_b), WalletStatus::Pending as u32);

    // 6. Congelar y revocar
    client.freeze_wallet(&s.asset_id, &s.compliance, &wallet_a);
    assert_eq!(client.wallet_status(&s.asset_id, &wallet_a), WalletStatus::Frozen as u32);
    client.revoke_wallet(&s.asset_id, &s.compliance, &wallet_a);
    assert_eq!(client.wallet_status(&s.asset_id, &wallet_a), WalletStatus::Revoked as u32);
}

#[test]
fn test_only_approved_issuers_create_assets() {
    let s = setup();
    let outsider = Address::generate(&s.env);

    let result = s.client.try_create_asset(&symbol_short!("X1"), &outsider, &s.compliance, &new_asset(&s.env, 10));
    assert_eq!(result, Err(Ok(RegistryError::IssuerNotApproved)));

    s.client.approve_issuer(&outsider);
    assert!(s.client.is_approved_issuer(&outsider));
    s.client.create_asset(&symbol_short!("X1"), &outsider, &s.compliance, &new_asset(&s.env, 10));

    s.client.revoke_issuer(&outsider);
    assert!(!s.client.is_approved_issuer(&outsider));
    let after_revoke = s.client.try_create_asset(&symbol_short!("X2"), &outsider, &s.compliance, &new_asset(&s.env, 10));
    assert_eq!(after_revoke, Err(Ok(RegistryError::IssuerNotApproved)));
}

#[test]
fn test_create_asset_is_signed_by_issuer() {
    let s = setup();
    s.client.create_asset(&symbol_short!("INV002"), &s.issuer, &s.compliance, &new_asset(&s.env, 5));
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.issuer);
}

#[test]
fn test_approve_issuer_requires_admin() {
    let s = setup();
    s.client.approve_issuer(&Address::generate(&s.env));
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
}

#[test]
fn test_duplicate_asset_and_invalid_supply_rejected() {
    let s = setup();
    let dup = s.client.try_create_asset(&s.asset_id, &s.issuer, &s.compliance, &new_asset(&s.env, 1));
    assert_eq!(dup, Err(Ok(RegistryError::AssetAlreadyExists)));

    let zero = s.client.try_create_asset(&symbol_short!("Z"), &s.issuer, &s.compliance, &new_asset(&s.env, 0));
    assert_eq!(zero, Err(Ok(RegistryError::InvalidMaxSupply)));
}

#[test]
fn test_each_asset_gets_its_own_token() {
    let s = setup();
    let token_2 = s.client.create_asset(&symbol_short!("INV002"), &s.issuer, &s.compliance, &new_asset(&s.env, 5));
    assert_ne!(token_2, s.client.get_token(&s.asset_id));
}

#[test]
fn test_document_versions_auto_increment() {
    let s = setup();
    let uri = String::from_str(&s.env, "https://assetra.io/docs/v.pdf");
    let v1 = s.client.add_document(&s.asset_id, &s.issuer, &BytesN::from_array(&s.env, &[2u8; 32]), &uri);
    let v2 = s.client.add_document(&s.asset_id, &s.compliance, &BytesN::from_array(&s.env, &[3u8; 32]), &uri);
    assert_eq!((v1, v2), (1, 2));
    assert_eq!(s.client.document_count(&s.asset_id), 2);
    assert_eq!(s.client.get_document(&s.asset_id, &1u32).doc_hash, BytesN::from_array(&s.env, &[2u8; 32]));
    assert_eq!(s.client.try_get_document(&s.asset_id, &7u32), Err(Ok(RegistryError::DocumentNotFound)));

    let outsider = Address::generate(&s.env);
    let denied = s.client.try_add_document(&s.asset_id, &outsider, &BytesN::from_array(&s.env, &[4u8; 32]), &uri);
    assert_eq!(denied, Err(Ok(RegistryError::Unauthorized)));
}

#[test]
fn test_status_transitions() {
    let s = setup();
    let set = |status: AssetStatus| s.client.try_set_asset_status(&s.asset_id, &s.issuer, &(status as u32));

    // Draft no puede saltar directamente a Paused ni a Redeemed
    assert_eq!(set(AssetStatus::Paused), Err(Ok(RegistryError::InvalidStatusTransition)));
    assert_eq!(set(AssetStatus::Redeemed), Err(Ok(RegistryError::InvalidStatusTransition)));

    assert!(set(AssetStatus::Active).is_ok());
    assert!(set(AssetStatus::Paused).is_ok());
    assert!(set(AssetStatus::Active).is_ok());
    assert!(set(AssetStatus::Redeemed).is_ok());

    // Redeemed es terminal
    assert_eq!(set(AssetStatus::Active), Err(Ok(RegistryError::InvalidStatusTransition)));

    // Valores fuera de la enumeración se rechazan
    let s2 = setup();
    let invalid = s2.client.try_set_asset_status(&s2.asset_id, &s2.issuer, &99u32);
    assert_eq!(invalid, Err(Ok(RegistryError::InvalidStatusTransition)));
}

#[test]
fn test_admin_can_only_pause() {
    let s = setup();
    let active = s.client.try_set_asset_status(&s.asset_id, &s.admin, &(AssetStatus::Active as u32));
    assert_eq!(active, Err(Ok(RegistryError::Unauthorized)));

    s.client.set_asset_status(&s.asset_id, &s.issuer, &(AssetStatus::Active as u32));
    s.client.set_asset_status(&s.asset_id, &s.admin, &(AssetStatus::Paused as u32));
    assert_eq!(s.client.get_asset(&s.asset_id).status, AssetStatus::Paused as u32);

    let outsider = Address::generate(&s.env);
    let denied = s.client.try_set_asset_status(&s.asset_id, &outsider, &(AssetStatus::Active as u32));
    assert_eq!(denied, Err(Ok(RegistryError::Unauthorized)));
}

#[test]
fn test_set_admin() {
    let s = setup();
    let new_admin = Address::generate(&s.env);
    s.client.set_admin(&new_admin);
    assert_eq!(s.client.admin(), new_admin);
}
