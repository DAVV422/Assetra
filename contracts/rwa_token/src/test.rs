#![cfg(test)]

use super::*;
use rwa_registry::{AssetStatus, NewAsset, RwaRegistry, RwaRegistryClient};
use soroban_sdk::{testutils::Address as _, symbol_short, BytesN, Env, String};

// El registro despliega el token desde su WASM: compilar antes con
// `cargo build --target wasm32v1-none --release -p rwa-token` (o `npm run test:contracts`).
const TOKEN_WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/rwa_token.wasm");
const MAX_SUPPLY: i128 = 1_000;

struct Setup<'a> {
    env: Env,
    registry: RwaRegistryClient<'a>,
    token: PermissionedRwaTokenClient<'a>,
    admin: Address,
    issuer: Address,
    compliance: Address,
    wallet_a: Address,
    wallet_b: Address,
    asset_id: Symbol,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let compliance = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);
    let asset_id = symbol_short!("FACT001");

    // 1. Desplegar RwaRegistry y aprobar al emisor
    let wasm_hash = env.deployer().upload_contract_wasm(TOKEN_WASM);
    let registry_id = env.register(RwaRegistry, (&admin, &wasm_hash));
    let registry = RwaRegistryClient::new(&env, &registry_id);
    registry.approve_issuer(&issuer);

    // 2. El emisor registra el activo: se despliega su token (inicia en Draft)
    let token_id = registry.create_asset(
        &asset_id,
        &issuer,
        &compliance,
        &NewAsset {
            asset_type: symbol_short!("invoice"),
            metadata_uri: String::from_str(&env, "https://assetra.io/factura-001.json"),
            main_hash: BytesN::from_array(&env, &[7u8; 32]),
            due_date: 1800000000u64,
            name: String::from_str(&env, "Factura Comercial 001"),
            symbol: String::from_str(&env, "FACT001"),
            decimals: 0,
            max_supply: MAX_SUPPLY,
        },
    );
    let token = PermissionedRwaTokenClient::new(&env, &token_id);

    // Autorizar al Emisor y a Wallet A. Wallet B NO se autoriza deliberadamente.
    registry.authorize_wallet(&asset_id, &compliance, &issuer);
    registry.authorize_wallet(&asset_id, &compliance, &wallet_a);

    Setup { env, registry, token, admin, issuer, compliance, wallet_a, wallet_b, asset_id }
}

fn set_status(s: &Setup, status: AssetStatus) {
    s.registry.set_asset_status(&s.asset_id, &s.issuer, &(status as u32));
}

#[test]
fn test_token_metadata() {
    let s = setup();
    assert_eq!(s.token.max_supply(), MAX_SUPPLY);
    assert_eq!(s.token.symbol(), String::from_str(&s.env, "FACT001"));
    assert_eq!(s.token.asset_id(), s.asset_id);
    assert_eq!(s.token.registry(), s.registry.address);
    assert_eq!(s.token.decimals(), 0);
}

#[test]
fn test_permissioned_transfer_flow() {
    let s = setup();
    let token = &s.token;

    // 3. No se puede emitir mientras el activo esté en Draft
    assert_eq!(token.try_mint(&s.issuer, &1000i128), Err(Ok(TokenError::AssetNotActive)));

    set_status(&s, AssetStatus::Active);

    // 4. Rechazar montos <= 0
    assert_eq!(token.try_mint(&s.issuer, &0i128), Err(Ok(TokenError::InvalidAmount)));

    // 5. Mint exitoso de 1,000 tokens al emisor
    token.mint(&s.issuer, &1000i128);
    assert_eq!(token.balance(&s.issuer), 1000i128);
    assert_eq!(token.total_supply(), 1000i128);

    // 6. Transferencia válida hacia Wallet A (Autorizada)
    token.transfer(&s.issuer, &s.wallet_a, &200i128);
    assert_eq!(token.balance(&s.issuer), 800i128);
    assert_eq!(token.balance(&s.wallet_a), 200i128);

    // 7. Transferencia hacia Wallet B (NO autorizada) -> ReceiverNotAuthorized, balances intactos
    assert_eq!(token.try_transfer(&s.issuer, &s.wallet_b, &100i128), Err(Ok(TokenError::ReceiverNotAuthorized)));
    assert_eq!(token.balance(&s.issuer), 800i128);
    assert_eq!(token.balance(&s.wallet_b), 0i128);

    // 8. Rechazar transferencias con monto negativo o cero
    assert_eq!(token.try_transfer(&s.issuer, &s.wallet_a, &-10i128), Err(Ok(TokenError::InvalidAmount)));

    // 9. Pausa de emergencia (estado Paused en el registro)
    set_status(&s, AssetStatus::Paused);
    assert_eq!(token.try_transfer(&s.issuer, &s.wallet_a, &50i128), Err(Ok(TokenError::AssetPaused)));
    assert_eq!(token.try_mint(&s.issuer, &1i128), Err(Ok(TokenError::AssetPaused)));
    assert_eq!(token.try_burn(&s.issuer, &1i128), Err(Ok(TokenError::AssetPaused)));
    set_status(&s, AssetStatus::Active);
    token.transfer(&s.issuer, &s.wallet_a, &50i128);
    assert_eq!(token.balance(&s.wallet_a), 250i128);

    // 10. Redención: el activo pasa a Redeemed y los titulares queman sus tokens
    set_status(&s, AssetStatus::Redeemed);
    assert_eq!(token.try_transfer(&s.issuer, &s.wallet_a, &1i128), Err(Ok(TokenError::AssetNotActive)));
    token.burn(&s.issuer, &750i128);
    token.burn(&s.wallet_a, &250i128);
    assert_eq!(token.total_supply(), 0i128);
}

#[test]
fn test_mint_is_signed_by_registered_issuer() {
    let s = setup();
    set_status(&s, AssetStatus::Active);
    s.token.mint(&s.issuer, &1i128);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.issuer);
}

#[test]
fn test_revoked_issuer_cannot_mint() {
    let s = setup();
    set_status(&s, AssetStatus::Active);
    s.registry.revoke_issuer(&s.issuer);
    assert_eq!(s.token.try_mint(&s.issuer, &1i128), Err(Ok(TokenError::IssuerNotApproved)));

    s.registry.approve_issuer(&s.issuer);
    s.token.mint(&s.issuer, &1i128);
}

#[test]
fn test_mint_respects_max_supply() {
    let s = setup();
    set_status(&s, AssetStatus::Active);

    s.token.mint(&s.issuer, &(MAX_SUPPLY - 1));
    assert_eq!(s.token.try_mint(&s.issuer, &2i128), Err(Ok(TokenError::MaxSupplyExceeded)));
    s.token.mint(&s.issuer, &1i128);
    assert_eq!(s.token.total_supply(), MAX_SUPPLY);

    // Quemar libera cupo
    s.token.burn(&s.issuer, &10i128);
    s.token.mint(&s.issuer, &10i128);
}

#[test]
fn test_frozen_wallet_cannot_send_receive_or_burn() {
    let s = setup();
    set_status(&s, AssetStatus::Active);
    s.token.mint(&s.wallet_a, &100i128);
    s.registry.freeze_wallet(&s.asset_id, &s.compliance, &s.wallet_a);

    assert_eq!(s.token.try_transfer(&s.wallet_a, &s.issuer, &10i128), Err(Ok(TokenError::WalletFrozen)));
    assert_eq!(s.token.try_transfer(&s.issuer, &s.wallet_a, &10i128), Err(Ok(TokenError::WalletFrozen)));
    assert_eq!(s.token.try_burn(&s.wallet_a, &10i128), Err(Ok(TokenError::WalletFrozen)));
    assert_eq!(s.token.try_mint(&s.wallet_a, &10i128), Err(Ok(TokenError::WalletFrozen)));
    assert_eq!(s.token.balance(&s.wallet_a), 100i128);
}

#[test]
fn test_revoked_sender_rejected() {
    let s = setup();
    set_status(&s, AssetStatus::Active);
    s.token.mint(&s.wallet_a, &100i128);
    s.registry.revoke_wallet(&s.asset_id, &s.compliance, &s.wallet_a);
    assert_eq!(s.token.try_transfer(&s.wallet_a, &s.issuer, &10i128), Err(Ok(TokenError::SenderNotAuthorized)));
}

#[test]
fn test_platform_admin_emergency_pause() {
    let s = setup();
    set_status(&s, AssetStatus::Active);
    s.token.mint(&s.issuer, &10i128);
    s.registry.set_asset_status(&s.asset_id, &s.admin, &(AssetStatus::Paused as u32));
    assert_eq!(s.token.try_transfer(&s.issuer, &s.wallet_a, &1i128), Err(Ok(TokenError::AssetPaused)));
}
