// Demostración on-chain automatizada en Stellar Testnet.
// Cada ejecución crea su PROPIO activo de demo (no toca FACT001) y recorre el ciclo completo:
// gobernanza de emisores, token por activo, documentos, whitelist, mint, transferencias,
// congelamiento, pausa, revocación del emisor y redención. Verifica cada resultado esperado.
//
//   npm run script:demo        (requiere npm run script:deploy && npm run script:seed)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const contractsJsonPath = path.join(process.cwd(), "contracts.json");

let passed = 0;
const failures: string[] = [];

function logStep(stepNum: number, title: string, explanation: string) {
  console.log("\n----------------------------------------------------------------------");
  console.log(`\x1b[1m\x1b[35m[PASO ${stepNum}] ${title}\x1b[0m`);
  console.log(`\x1b[34mℹ ${explanation}\x1b[0m`);
  console.log("----------------------------------------------------------------------");
}

interface InvokeResult {
  ok: boolean;
  output: string;
}

/** Invoca un contrato con el Stellar CLI. Sin shell: los argumentos nunca se interpretan como comandos. */
function invoke(source: string, contractId: string, fn: string, args: string[] = [], readOnly = false): InvokeResult {
  const cliArgs = [
    "contract", "invoke", "--id", contractId, "--source-account", source, "--network", "testnet",
    ...(readOnly ? ["--send=no"] : []),
    "--", fn, ...args
  ];
  console.log(`\x1b[36m> [${source}] ${fn} ${args.join(" ")}\x1b[0m`);
  try {
    const output = execFileSync("stellar", cliArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { ok: true, output };
  } catch (error: any) {
    return { ok: false, output: `${error.stderr ?? ""}${error.stdout ?? ""}`.trim() };
  }
}

const read = (contractId: string, fn: string, args: string[] = []) => invoke("admin", contractId, fn, args, true);

function check(condition: boolean, label: string, detail = "") {
  if (condition) {
    passed++;
    console.log(`\x1b[32m  ✔ ${label}\x1b[0m`);
  } else {
    failures.push(label);
    console.log(`\x1b[31m  ✘ ${label}${detail ? `\n    ${detail.slice(0, 300)}` : ""}\x1b[0m`);
  }
}

function expectOk(result: InvokeResult, label: string): string {
  check(result.ok, label, result.output);
  return result.output;
}

function expectError(result: InvokeResult, code: number, name: string, label: string) {
  const matched = !result.ok && result.output.includes(`Error(Contract, #${code})`);
  check(matched, `${label} → rechazado con ${name} (#${code})`, result.ok ? `Se esperaba un rechazo y la operación tuvo éxito: ${result.output}` : result.output);
}

function main() {
  console.log("\n======================================================================");
  console.log("       ASSETRA - DEMOSTRACIÓN COMPLETA ON-CHAIN EN TESTNET");
  console.log("======================================================================");

  if (!fs.existsSync(contractsJsonPath)) {
    console.error("❌ No se encontró contracts.json. Ejecuta primero npm run script:deploy y npm run script:seed");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(contractsJsonPath, "utf8"));
  const reg: string = config.registryContractId;
  const accounts = config.accounts ?? {};
  const { admin, issuer, compliance, walletA, walletB } = accounts;
  if (!reg || !admin || !issuer || !compliance || !walletA || !walletB) {
    console.error("❌ Cuentas o contratos no configurados en contracts.json. Ejecuta primero: npm run script:seed");
    process.exit(1);
  }

  const assetId = `DEMO${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const maxSupply = 1000;
  console.log(`RwaRegistry:  ${reg}`);
  console.log(`Activo demo:  ${assetId} (se crea en esta ejecución)`);
  console.log(`Admin:        ${admin}`);
  console.log(`Emisor:       ${issuer}`);
  console.log(`Compliance:   ${compliance}`);
  console.log(`Wallet A:     ${walletA} (se autorizará)`);
  console.log(`Wallet B:     ${walletB} (nunca autorizada)`);

  const paramsPath = path.join(os.tmpdir(), `assetra-${assetId}-params.json`);
  fs.writeFileSync(paramsPath, JSON.stringify({
    asset_type: "invoice",
    metadata_uri: `https://assetra.io/assets/${assetId.toLowerCase()}.json`,
    main_hash: "a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20",
    due_date: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
    name: `Factura Demo ${assetId}`,
    symbol: assetId,
    decimals: 0,
    max_supply: String(maxSupply)
  }), "utf8");
  const createArgs = (who: string) => ["--asset_id", assetId, "--issuer", who, "--compliance_officer", compliance, "--params-file-path", paramsPath];

  try {
    // PASO 1 ------------------------------------------------------------
    logStep(1, "GOBERNANZA: SOLO EMISORES APROBADOS", "Wallet B (sin KYB aprobado) intenta registrar un activo; el admin aprueba al emisor.");
    expectError(invoke("wallet_b", reg, "create_asset", createArgs(walletB)), 7, "IssuerNotApproved", "Wallet B intenta crear un activo");
    expectOk(invoke("admin", reg, "approve_issuer", ["--issuer", issuer]), "El admin aprueba al emisor");

    // PASO 2 ------------------------------------------------------------
    logStep(2, "REGISTRO DEL ACTIVO Y DESPLIEGUE DE SU TOKEN", "El emisor firma create_asset: se registra en Draft y se despliega su token con max_supply.");
    const created = invoke("issuer", reg, "create_asset", createArgs(issuer));
    const token = JSON.parse(expectOk(created, "El emisor registra el activo") || '""');
    if (!token) throw new Error("No se obtuvo la dirección del token: no se puede continuar");
    console.log(`  Token del activo: ${token}\n  https://stellar.expert/explorer/testnet/contract/${token}`);
    check(JSON.parse(read(token, "max_supply").output) === String(maxSupply), `El token tiene max_supply = ${maxSupply}`);
    expectError(invoke("issuer", token, "mint", ["--to", issuer, "--amount", "10"]), 6, "AssetNotActive", "Mint con el activo en Draft");

    // PASO 3 ------------------------------------------------------------
    logStep(3, "RESPALDO DOCUMENTAL", "El emisor registra dos versiones del documento; un tercero no puede añadir documentos.");
    const docArgs = (hash: string) => ["--asset_id", assetId, "--caller", issuer, "--doc_hash", hash, "--uri", "https://assetra.io/docs/demo.pdf"];
    check(expectOk(invoke("issuer", reg, "add_document", docArgs("ab".repeat(32))), "Documento registrado") === "1", "Versión asignada automáticamente: 1");
    check(expectOk(invoke("issuer", reg, "add_document", docArgs("cd".repeat(32))), "Nueva versión registrada") === "2", "Versión asignada automáticamente: 2");
    expectError(
      invoke("wallet_b", reg, "add_document", ["--asset_id", assetId, "--caller", walletB, "--doc_hash", "ef".repeat(32), "--uri", "x"]),
      3, "Unauthorized", "Wallet B intenta añadir un documento"
    );

    // PASO 4 ------------------------------------------------------------
    logStep(4, "ACTIVACIÓN", "El emisor activa el activo (Draft → Active). Volver a Draft no está permitido.");
    expectOk(invoke("issuer", reg, "set_asset_status", ["--asset_id", assetId, "--caller", issuer, "--new_status", "1"]), "Activo en estado Active");
    expectError(invoke("issuer", reg, "set_asset_status", ["--asset_id", assetId, "--caller", issuer, "--new_status", "0"]), 4, "InvalidStatusTransition", "Active → Draft");

    // PASO 5 ------------------------------------------------------------
    logStep(5, "WHITELIST DE COMPLIANCE", "El oficial de compliance autoriza al emisor y a Wallet A. Wallet B intenta autorizarse sola.");
    const auth = (who: string) => ["--asset_id", assetId, "--compliance_officer", compliance, "--wallet", who];
    expectOk(invoke("compliance", reg, "authorize_wallet", auth(issuer)), "Emisor autorizado");
    expectOk(invoke("compliance", reg, "authorize_wallet", auth(walletA)), "Wallet A autorizada");
    expectError(
      invoke("wallet_b", reg, "authorize_wallet", ["--asset_id", assetId, "--compliance_officer", walletB, "--wallet", walletB]),
      3, "Unauthorized", "Wallet B intenta autorizarse a sí misma"
    );

    // PASO 6 ------------------------------------------------------------
    logStep(6, "EMISIÓN (MINT) POR EL EMISOR", `El emisor emite ${maxSupply} tokens; emitir uno más supera el suministro máximo.`);
    expectOk(invoke("issuer", token, "mint", ["--to", issuer, "--amount", String(maxSupply)]), `Mint de ${maxSupply} tokens`);
    expectError(invoke("issuer", token, "mint", ["--to", issuer, "--amount", "1"]), 10, "MaxSupplyExceeded", "Mint por encima del máximo");

    // PASO 7 ------------------------------------------------------------
    logStep(7, "TRANSFERENCIAS PERMISIONADAS", "Transferencia válida a Wallet A; rechazo de monto 0 y de destino no autorizado.");
    const transfer = (source: string, from: string, to: string, amount: string) => invoke(source, token, "transfer", ["--from", from, "--to", to, "--amount", amount]);
    expectError(transfer("issuer", issuer, walletA, "0"), 9, "InvalidAmount", "Transferencia de 0 tokens");
    expectOk(transfer("issuer", issuer, walletA, "200"), "Emisor → Wallet A: 200 tokens");
    expectError(transfer("issuer", issuer, walletB, "100"), 1, "ReceiverNotAuthorized", "Emisor → Wallet B (no autorizada)");
    check(JSON.parse(read(token, "balance", ["--id", walletA]).output) === "200", "Saldo Wallet A = 200");
    check(JSON.parse(read(token, "balance", ["--id", walletB]).output) === "0", "Saldo Wallet B intacto en 0");

    // PASO 8 ------------------------------------------------------------
    logStep(8, "CONGELAMIENTO CAUTELAR", "Compliance congela Wallet A: no puede recibir ni enviar. Luego se re-autoriza.");
    expectOk(invoke("compliance", reg, "freeze_wallet", auth(walletA)), "Wallet A congelada");
    expectError(transfer("issuer", issuer, walletA, "10"), 3, "WalletFrozen", "Emisor → Wallet A congelada");
    expectError(transfer("wallet_a", walletA, issuer, "10"), 3, "WalletFrozen", "Wallet A congelada intenta enviar");
    expectOk(invoke("compliance", reg, "authorize_wallet", auth(walletA)), "Wallet A re-autorizada");

    // PASO 9 ------------------------------------------------------------
    logStep(9, "FRENO DE EMERGENCIA DE LA PLATAFORMA", "El admin pausa el activo; no puede reactivarlo (solo el emisor o compliance).");
    expectOk(invoke("admin", reg, "set_asset_status", ["--asset_id", assetId, "--caller", admin, "--new_status", "2"]), "Admin pausa el activo");
    expectError(transfer("issuer", issuer, walletA, "10"), 4, "AssetPaused", "Transferencia con el activo pausado");
    expectError(invoke("admin", reg, "set_asset_status", ["--asset_id", assetId, "--caller", admin, "--new_status", "1"]), 3, "Unauthorized", "Admin intenta reactivar");
    expectOk(invoke("issuer", reg, "set_asset_status", ["--asset_id", assetId, "--caller", issuer, "--new_status", "1"]), "Emisor reactiva el activo");

    // PASO 10 -----------------------------------------------------------
    logStep(10, "REVOCACIÓN DEL EMISOR", "El admin revoca al emisor: deja de poder emitir de inmediato. Luego se restablece.");
    expectOk(invoke("issuer", token, "burn", ["--from", issuer, "--amount", "50"]), "El emisor quema 50 (libera cupo)");
    expectOk(invoke("admin", reg, "revoke_issuer", ["--issuer", issuer]), "Admin revoca al emisor");
    expectError(invoke("issuer", token, "mint", ["--to", issuer, "--amount", "10"]), 11, "IssuerNotApproved", "Emisor revocado intenta emitir");
    expectOk(invoke("admin", reg, "approve_issuer", ["--issuer", issuer]), "Admin vuelve a aprobar al emisor");

    // PASO 11 -----------------------------------------------------------
    logStep(11, "REDENCIÓN", "El activo pasa a Redeemed: sin transferencias ni emisión; los titulares queman sus tokens.");
    expectOk(invoke("issuer", reg, "set_asset_status", ["--asset_id", assetId, "--caller", issuer, "--new_status", "3"]), "Activo redimido");
    expectError(transfer("issuer", issuer, walletA, "10"), 6, "AssetNotActive", "Transferencia tras la redención");
    expectError(invoke("issuer", token, "mint", ["--to", issuer, "--amount", "10"]), 6, "AssetNotActive", "Mint tras la redención");
    expectOk(invoke("issuer", token, "burn", ["--from", issuer, "--amount", "750"]), "El emisor quema sus 750 tokens");
    expectOk(invoke("wallet_a", token, "burn", ["--from", walletA, "--amount", "200"]), "Wallet A quema sus 200 tokens");
    check(JSON.parse(read(token, "total_supply").output) === "0", "Suministro en circulación = 0");
  } catch (err: any) {
    failures.push(err.message);
    console.error(`\x1b[31m❌ ${err.message}\x1b[0m`);
  } finally {
    fs.rmSync(paramsPath, { force: true });
  }

  console.log("\n======================================================================");
  if (failures.length === 0) {
    console.log(`\x1b[32m  DEMOSTRACIÓN COMPLETADA: ${passed} verificaciones correctas en Testnet\x1b[0m`);
  } else {
    console.log(`\x1b[31m  DEMOSTRACIÓN CON FALLOS: ${passed} correctas, ${failures.length} fallidas\x1b[0m`);
    failures.forEach((f) => console.log(`\x1b[31m   - ${f}\x1b[0m`));
  }
  console.log(`  Activo de demo: ${assetId} (FACT001 no se modificó)`);
  console.log("======================================================================\n");
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
