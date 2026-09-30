import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const contractsJsonPath = path.join(rootDir, "contracts.json");

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
  const tokenId = contractsConfig.tokenContractId;

  console.log(`RwaRegistry Contract: ${registryId}`);
  console.log(`RwaToken Contract:    ${tokenId}`);

  // 1. Asegurar identidades
  console.log("\n[1/5] Verificando y fondeando identidades de prueba...");
  const issuer = ensureAccount("issuer");
  const compliance = ensureAccount("compliance");
  const walletA = ensureAccount("wallet_a");
  const walletB = ensureAccount("wallet_b");
  const admin = runCommand("stellar keys address admin", true);

  // 2. Registrar el activo "Factura Comercial 001" en RwaRegistry
  console.log("\n[2/5] Registrando 'Factura Comercial 001' en RwaRegistry...");
  const assetId = "FACT001";
  const mainHash = "a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20a47f8c0d68d91e20";
  const dueDate = "1797811200"; // 2026-12-20

  try {
    runCommand(
      `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- create_asset --asset_id ${assetId} --issuer ${issuer} --compliance_officer ${compliance} --asset_type invoice --metadata_uri "https://assetra.io/assets/factura-001.json" --main_hash ${mainHash} --due_date ${dueDate}`
    );
    console.log(`\x1b[32m✔ Activo ${assetId} registrado en estado Draft.\x1b[0m`);
  } catch (err: any) {
    if (err.stderr && err.stderr.includes("AssetAlreadyExists")) {
      console.log(`ℹ El activo ${assetId} ya había sido registrado.`);
    } else {
      throw err;
    }
  }

  // 3. Asociar Documento de soporte
  console.log("\n[3/5] Registrando hash SHA-256 de documento soporte en RwaRegistry...");
  try {
    runCommand(
      `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- add_document --asset_id ${assetId} --caller ${issuer} --doc_hash ${mainHash} --uri "https://assetra.io/docs/factura-001.pdf" --version 1`
    );
    console.log("\x1b[32m✔ Documento v1 vinculado al activo.\x1b[0m");
  } catch (err: any) {
    console.log("ℹ Documento ya registrado o no requirió cambios.");
  }

  // 4. Activar el activo y configurar permisos de cumplimiento
  console.log("\n[4/5] Activando activo y configurando lista de cumplimiento (Compliance)...");
  // Activar activo (status 1 = Active)
  runCommand(
    `stellar contract invoke --id ${registryId} --source-account issuer --network testnet -- set_asset_status --asset_id ${assetId} --caller ${issuer} --new_status 1`
  );
  console.log("\x1b[32m✔ Estado de activo cambiado a 'Active'.\x1b[0m");

  // Autorizar a Issuer
  runCommand(
    `stellar contract invoke --id ${registryId} --source-account compliance --network testnet -- authorize_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${issuer}`
  );
  console.log(`\x1b[32m✔ Emisor (${issuer}) AUTORIZADO por Compliance.\x1b[0m`);

  // Autorizar a Wallet A (Inversor Autorizado)
  runCommand(
    `stellar contract invoke --id ${registryId} --source-account compliance --network testnet -- authorize_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${walletA}`
  );
  console.log(`\x1b[32m✔ Wallet A (${walletA}) AUTORIZADA por Compliance.\x1b[0m`);

  // Nota sobre Wallet B:
  console.log(`\x1b[33mℹ Wallet B (${walletB}) NO AUTORIZADA (reservada para prueba de bloqueo).\x1b[0m`);

  // 5. Emisión inicial (Mint) de 1,000 tokens permisionados al emisor
  console.log("\n[5/5] Emitiendo 1,000 tokens FACT001 hacia la cuenta del Emisor...");
  try {
    runCommand(
      `stellar contract invoke --id ${tokenId} --source-account admin --network testnet -- mint --admin ${admin} --to ${issuer} --amount 1000`
    );
    console.log("\x1b[32m✔ 1,000 tokens FACT001 emitidos exitosamente al Emisor.\x1b[0m");
  } catch (err: any) {
    console.log("ℹ Los tokens ya fueron emitidos previamente.");
  }

  // 6. Actualizar contracts.json con las cuentas
  contractsConfig.accounts = {
    admin,
    issuer,
    compliance,
    walletA,
    walletB
  };
  fs.writeFileSync(contractsJsonPath, JSON.stringify(contractsConfig, null, 2), "utf8");
  console.log(`✔ Archivo contracts.json actualizado con las direcciones de prueba.`);

  console.log("\n=======================================================");
  console.log("             ¡SEED COMPLETADO EXITOSAMENTE!");
  console.log("=======================================================");
  console.log(`Emisor (Issuer):        ${issuer} (Saldo: 1000 FACT001)`);
  console.log(`Compliance Officer:     ${compliance}`);
  console.log(`Wallet A (Autorizada):  ${walletA}`);
  console.log(`Wallet B (Bloqueada):   ${walletB}`);
  console.log("=======================================================\n");
  console.log("Puedes ejecutar la demostración completa con: npm run script:demo\n");
}

main().catch((err) => {
  console.error("\n❌ Falló el seed:", err.message);
  process.exit(1);
});
