#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, symbol_short, BytesN, Env};

#[test]
fn test_create_and_authorize_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RwaRegistry, ());
    let client = RwaRegistryClient::new(&env, &contract_id);

    let issuer = Address::generate(&env);
    let compliance = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);

    let asset_id = symbol_short!("INV001");
    let asset_type = symbol_short!("invoice");
    let metadata_uri = String::from_str(&env, "https://assetra.io/assets/inv001.json");
    let main_hash = BytesN::from_array(&env, &[1u8; 32]);
    let due_date = 1770000000u64;

    // Crear activo
    client.create_asset(&asset_id, &issuer, &asset_type, &metadata_uri, &main_hash, &due_date);

    let asset = client.get_asset(&asset_id);
    assert_eq!(asset.status, AssetStatus::Draft as u32);
    assert_eq!(asset.issuer, issuer);

    // Activar activo
    client.set_asset_status(&asset_id, &issuer, &(AssetStatus::Active as u32));
    let asset_active = client.get_asset(&asset_id);
    assert_eq!(asset_active.status, AssetStatus::Active as u32);

    // Autorizar Wallet A
    assert!(!client.is_authorized(&asset_id, &wallet_a));
    client.authorize_wallet(&asset_id, &compliance, &wallet_a);
    assert!(client.is_authorized(&asset_id, &wallet_a));

    // Wallet B permanece no autorizada
    assert!(!client.is_authorized(&asset_id, &wallet_b));

    // Congelar Wallet A
    client.freeze_wallet(&asset_id, &compliance, &wallet_a);
    assert!(!client.is_authorized(&asset_id, &wallet_a));
}
