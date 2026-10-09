import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const contractsJsonPath = path.join(rootDir, "contracts.json");
const maxSupply = Number(process.env.ASSETRA_MAX_SUPPLY ?? 1000);

function runCommand(command: string, silent = false): string {
  if (!silent) console.log(`\x1b[36m> ${command}\x1b[0m`);
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
    return output.trim();
  } catch (error: any) {
    if (!silent) console.error(`\x1b[31mError ejecutando: ${command}\x1b[0m`);
    throw error;
  }
}

/** Invocación de solo lectura (simulación, sin enviar transacción). */
function view(contractId: string, fn: string): any {
  return JSON.parse(runCommand(`stellar contract invoke --id ${contractId} --source-account admin --network testnet --send=no -- ${fn}`, true));
}

function ensureAccount(name: string): string {
  try {
    const address = runCommand(`stellar keys address ${name}`, true);
    console.log(`Cuenta existente [${name}]: ${address}`);
    return address;
  } catch {
    console.log(`Creando y fondeando cuenta [${name}] con Friendbot...`);
    runCommand(`stellar keys generate ${name} --network testnet --fund`);
    const address = runCommand(`stellar keys address ${name}`, true);
    console.log(`Cuenta creada [${name}]: ${address}`);
    return address;
  }
}

async function main() {
  console.log("\n=======================================================");
  console.log("       ASSETRA - SEED: DATOS INICIALES EN TESTNET");
  console.log("=======================================================\n");

  if (!fs.existsSync(contractsJsonPath)) {
    console.error("❌ No se encontró contracts.json. Ejecuta primero: npm run script:deploy");
    process.exit(1);
  }

  const contractsConfig = JSON.parse(fs.readFileSync(contractsJsonPath, "utf8"));
  const registryId = contractsConfig.registryContractId;
  const assetId: string = contractsConfig.assetId ?? "FACT001";
  console.log(`RwaRegistry Contract: ${registryId}`);

  // 1. Asegurar identidades
  console.log("\n[1/6] Verificando y fondeando identidades de prueba...");
  const admin = runCommand("stellar keys address admin", true);
  const issuer = ensureAccount("issuer");
  const compliance = ensureAccount("compliance");
  const walletA = ensureAccount("wallet_a");
  const walletB = ensureAccount("wallet_b");

  // 2. El admin de la plataforma aprueba al emisor (tras su KYB fuera de la cadena)
  console.log("\n[2/6] Aprobando al emisor en la plataforma...");
  runCommand(`stellar contract invoke --id ${registryId} --source-account admin --network testnet -- approve_issuer --issuer ${issuer}`);
  console.log(`\x1b[32m✔ Emisor ${issuer} APROBADO por el admin.\x1b[0m`);

  // 3. El emisor registra "Factura Comercial 001": su token se despliega en la misma transacción
  console.log("\n[3/6] El emisor registra 'Factura Comercial 001' (se crea su token)...");
  const mainHash = "a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20";
  const params = {
    asset_type: "invoice",
    metadata_uri: "https://assetra.io/assets/factura-001.json",
    main_hash: mainHash,
    due_date: 1797811200, // 2026-12-20
    name: "Factura Comercial 001",
    symbol: assetId,
    decimals: 0,
    max_supply: String(maxSupply)
  };
  // El struct se pasa por archivo para evitar problemas de comillas entre shells
  const paramsPath = path.join(os.tmpdir(), `assetra-${assetId}-params.json`);
  fs.writeFileSync(paramsPath, JSON.stringify(params), "utf8");

  let tokenId: string;
  try {
    tokenId = JSON.parse(runCommand(
      `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- create_asset --asset_id ${assetId} --issuer ${issuer} --compliance_officer ${compliance} --params-file-path "${paramsPath}"`
    ));
    console.log(`\x1b[32m✔ Activo ${assetId} registrado en Draft. Token: ${tokenId}\x1b[0m`);
  } catch (err: any) {
    if (err.stderr && (err.stderr.includes("AssetAlreadyExists") || err.stderr.includes("Error(Contract, #1)"))) {
      console.log(`ℹ El activo ${assetId} ya había sido registrado.`);
      tokenId = view(registryId, `get_token --asset_id ${assetId}`);
    } else {
      throw err;
    }
  } finally {
    fs.rmSync(paramsPath, { force: true });
  }

  // 4. Documento de soporte (la versión la asigna el contrato)
  console.log("\n[4/6] Registrando hash SHA-256 de documento soporte en RwaRegistry...");
  const docCount = Number(view(registryId, `document_count --asset_id ${assetId}`));
  if (docCount === 0) {
    const version = runCommand(
      `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- add_document --asset_id ${assetId} --caller ${issuer} --doc_hash ${mainHash} --uri "https://assetra.io/docs/factura-001.pdf"`
    );
    console.log(`\x1b[32m✔ Documento v${version} vinculado al activo.\x1b[0m`);
  } else {
    console.log(`ℹ El activo ya tiene ${docCount} documento(s).`);
  }

  // 5. Activar el activo y configurar la whitelist de compliance
  console.log("\n[5/6] Activando activo y configurando lista de cumplimiento (Compliance)...");
  try {
    runCommand(
      `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- set_asset_status --asset_id ${assetId} --caller ${issuer} --new_status 1`
    );
    console.log("\x1b[32m✔ Estado de activo cambiado a 'Active'.\x1b[0m");
  } catch {
    // La máquina de estados rechaza Active → Active (InvalidStatusTransition)
    console.log("ℹ El activo ya estaba activo (si fue redimido por la demo, vuelve a desplegar).");
  }

  runCommand(
    `stellar contract invoke --id ${registryId} --source-account compliance --network testnet -- authorize_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${issuer}`
  );
  console.log(`\x1b[32m✔ Emisor (${issuer}) AUTORIZADO por Compliance.\x1b[0m`);

  runCommand(
    `stellar contract invoke --id ${registryId} --source-account compliance --network testnet -- authorize_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${walletA}`
  );
  console.log(`\x1b[32m✔ Wallet A (${walletA}) AUTORIZADA por Compliance.\x1b[0m`);
  console.log(`\x1b[33mℹ Wallet B (${walletB}) NO AUTORIZADA (reservada para prueba de bloqueo).\x1b[0m`);

  // 6. Emisión inicial: la firma el EMISOR del activo (el token lee sus roles del registro)
  console.log(`\n[6/6] El emisor emite ${maxSupply} tokens ${assetId} hacia su cuenta...`);
  const supply = Number(view(tokenId, "total_supply"));
  if (supply === 0) {
    runCommand(`stellar contract invoke --id ${tokenId} --source-account issuer --network testnet -- mint --to ${issuer} --amount ${maxSupply}`);
    console.log(`\x1b[32m✔ ${maxSupply} tokens ${assetId} emitidos al Emisor.\x1b[0m`);
  } else {
    console.log(`ℹ Los tokens ya fueron emitidos previamente (supply actual: ${supply}).`);
  }

  // 7. Actualizar contracts.json con el token y las cuentas
  contractsConfig.tokenContractId = tokenId;
  contractsConfig.explorers = {
    ...contractsConfig.explorers,
    token: `https://stellar.expert/explorer/testnet/contract/${tokenId}`
  };
  contractsConfig.accounts = { admin, issuer, compliance, walletA, walletB };
  fs.writeFileSync(contractsJsonPath, JSON.stringify(contractsConfig, null, 2), "utf8");
  // Copia empaquetada en la imagen Docker del backend (Koyeb)
  fs.writeFileSync(path.join(rootDir, "backend", "contracts.json"), JSON.stringify(contractsConfig, null, 2), "utf8");
  console.log("✔ contracts.json y backend/contracts.json actualizados.");

  console.log("\n=======================================================");
  console.log("             ¡SEED COMPLETADO EXITOSAMENTE!");
  console.log("=======================================================");
  console.log(`Token ${assetId}:         ${tokenId}`);
  console.log(`Emisor (Issuer):        ${issuer} (Saldo: ${maxSupply} ${assetId})`);
  console.log(`Compliance Officer:     ${compliance}`);
  console.log(`Wallet A (Autorizada):  ${walletA}`);
  console.log(`Wallet B (Bloqueada):   ${walletB}`);
  console.log("=======================================================\n");
  console.log("Puedes ejecutar la demostración completa con: npm run script:demo\n");
}

main().catch((err) => {
  console.error("\n❌ Falló el seed:", err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
