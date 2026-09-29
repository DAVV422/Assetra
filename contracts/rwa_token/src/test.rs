#![cfg(test)]

use super::*;
use rwa_registry::{AssetStatus, RwaRegistry, RwaRegistryClient};
use soroban_sdk::{
    testutils::Address as _, symbol_short, BytesN, Env, String,
};

#[test]
fn test_permissioned_transfer_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Desplegar RwaRegistry
    let registry_id = env.register(RwaRegistry, ());
    let registry_client = RwaRegistryClient::new(&env, &registry_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let compliance = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);

    let asset_id = symbol_short!("FACT001");
    let asset_type = symbol_short!("invoice");
    let metadata_uri = String::from_str(&env, "https://assetra.io/factura-001.json");
    let main_hash = BytesN::from_array(&env, &[7u8; 32]);
    let due_date = 1800000000u64;

    // Registrar activo
    registry_client.create_asset(&asset_id, &issuer, &asset_type, &metadata_uri, &main_hash, &due_date);
    registry_client.set_asset_status(&asset_id, &issuer, &(AssetStatus::Active as u32));

    // Autorizar al Emisor y a Wallet A en el registro
    registry_client.authorize_wallet(&asset_id, &compliance, &issuer);
    registry_client.authorize_wallet(&asset_id, &compliance, &wallet_a);
    // Nota: Wallet B NO se autoriza deliberadamente (simula el rechazo de compliance)

    // 2. Desplegar PermissionedRwaToken
    let token_id = env.register(PermissionedRwaToken, ());
    let token_client = PermissionedRwaTokenClient::new(&env, &token_id);

    token_client.initialize(
        &admin,
        &registry_id,
        &asset_id,
        &0u32,
        &String::from_str(&env, "Factura Comercial 001"),
        &String::from_str(&env, "FACT001"),
    );

    // 3. Mint de 1,000 tokens al emisor
    token_client.mint(&admin, &issuer, &1000i128);
    assert_eq!(token_client.balance(&issuer), 1000i128);
    assert_eq!(token_client.total_supply(), 1000i128);

    // 4. Transferencia válida hacia Wallet A (Autorizada)
    token_client.transfer(&issuer, &wallet_a, &200i128);
    assert_eq!(token_client.balance(&issuer), 800i128);
    assert_eq!(token_client.balance(&wallet_a), 200i128);

    // 5. Transferencia inválida hacia Wallet B (NO autorizada) -> Debe fallar con ReceiverNotAuthorized
    let result = token_client.try_transfer(&issuer, &wallet_b, &100i128);
    assert_eq!(result, Err(Ok(TokenError::ReceiverNotAuthorized)));

    // Verificar que los balances NO cambiaron tras el rechazo
    assert_eq!(token_client.balance(&issuer), 800i128);
    assert_eq!(token_client.balance(&wallet_b), 0i128);

    // 6. Prueba de Pausa de Emergencia
    token_client.pause(&admin);
    let pause_result = token_client.try_transfer(&issuer, &wallet_a, &50i128);
    assert_eq!(pause_result, Err(Ok(TokenError::AssetPaused)));

    token_client.unpause(&admin);
    token_client.transfer(&issuer, &wallet_a, &50i128);
    assert_eq!(token_client.balance(&wallet_a), 250i128);

    // 7. Prueba de Redención / Burn
    token_client.burn(&issuer, &750i128);
    assert_eq!(token_client.balance(&issuer), 0i128);
    assert_eq!(token_client.total_supply(), 250i128);
}
