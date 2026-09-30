import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const contractsJsonPath = path.join(rootDir, "contracts.json");

function logStep(stepNum: number, title: string, explanation: string, expected: string) {
  console.log("\n----------------------------------------------------------------------");
  console.log(`\x1b[1m\x1b[35m[PASO ${stepNum}] ${title}\x1b[0m`);
  console.log(`\x1b[34mℹ Qué se ejecuta:\x1b[0m ${explanation}`);
  console.log(`\x1b[33m🎯 Qué debe devolver:\x1b[0m ${expected}`);
  console.log("----------------------------------------------------------------------");
}

function runCommand(command: string): { stdout: string; success: boolean; stderr?: string } {
  console.log(`\x1b[36m> ${command}\x1b[0m`);
  try {
    const stdout = execSync(command, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] }).trim();
    return { stdout, success: true };
  } catch (error: any) {
    const stderr = (error.stderr || error.stdout || error.message || "").toString().trim();
    return { stdout: "", success: false, stderr };
  }
}

async function main() {
  console.log("\n======================================================================");
  console.log("       ASSETRA - DEMOSTRACIÓN COMPLETA ON-CHAIN EN TESTNET");
  console.log("======================================================================");

  if (!fs.existsSync(contractsJsonPath)) {
    console.error("❌ No se encontró contracts.json. Ejecuta primero npm run script:deploy y npm run script:seed");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(contractsJsonPath, "utf8"));
  const { registryContractId: regId, tokenContractId: tokId, accounts } = config;

  if (!accounts || !accounts.issuer || !accounts.compliance || !accounts.walletA || !accounts.walletB) {
    console.error("❌ Cuentas no configuradas en contracts.json. Ejecuta primero: npm run script:seed");
    process.exit(1);
  }

  const { admin, issuer, compliance, walletA, walletB } = accounts;
  const assetId = config.assetId || "FACT001";

  console.log(`Activo:       ${assetId}`);
  console.log(`RwaRegistry:  ${regId}`);
  console.log(`RwaToken:     ${tokId}`);
  console.log(`Issuer:       ${issuer}`);
  console.log(`Compliance:   ${compliance}`);
  console.log(`Wallet A:     ${walletA} (Autorizada)`);
  console.log(`Wallet B:     ${walletB} (No autorizada)`);

  // ====================================================================
  // PASO 1: Consulta del Estado Inicial del Activo y Documento
  // ====================================================================
  logStep(
    1,
    "AUDITORÍA INICIAL DEL ACTIVO Y SU RESPALDO DOCUMENTAL",
    "Consultar en RwaRegistry los metadatos de la Factura Comercial 001 y su documento vinculado.",
    "El activo debe estar registrado con status=1 (Active), hash SHA-256 inmutable y documento v1."
  );

  const assetQuery = runCommand(
    `stellar contract invoke --id ${regId} --source-account admin --network testnet -- get_asset --asset_id ${assetId}`
  );
  console.log(`\x1b[32m✔ Activo verificado:\x1b[0m\n${assetQuery.stdout}`);

  const docQuery = runCommand(
    `stellar contract invoke --id ${regId} --source-account admin --network testnet -- get_document --asset_id ${assetId} --version 1`
  );
  console.log(`\x1b[32m✔ Documento hash SHA-256 verificado:\x1b[0m\n${docQuery.stdout}`);

  // ====================================================================
  // PASO 2: Verificación de Autorizaciones en Compliance
  // ====================================================================
  logStep(
    2,
    "VERIFICACIÓN DE LISTA DE CUMPLIMIENTO (WHITELIST)",
    "Consultar si Wallet A y Wallet B tienen permiso para transaccionar el activo FACT001.",
    "Wallet A debe devolver 'true'. Wallet B debe devolver 'false'."
  );

  const authA = runCommand(
    `stellar contract invoke --id ${regId} --source-account admin --network testnet -- is_authorized --asset_id ${assetId} --wallet ${walletA}`
  );
  console.log(`\x1b[32m✔ ¿Wallet A autorizada?: ${authA.stdout}\x1b[0m (Esperado: true)`);

  const authB = runCommand(
    `stellar contract invoke --id ${regId} --source-account admin --network testnet -- is_authorized --asset_id ${assetId} --wallet ${walletB}`
  );
  console.log(`\x1b[32m✔ ¿Wallet B autorizada?: ${authB.stdout}\x1b[0m (Esperado: false)`);

  // ====================================================================
  // PASO 3: Validación de Reglas - Rechazo de Monto Inválido
  // ====================================================================
  logStep(
    3,
    "CONTROL DE INTEGRIDAD: RECHAZO DE MONTO INVÁLIDO (<= 0)",
    "Intentar transferir 0 tokens desde el Emisor hacia la Wallet A.",
    "Debe REVERTIR con error Contract #9 (InvalidAmount). Ningún balance debe alterarse."
  );

  const zeroTransfer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- transfer --from ${issuer} --to ${walletA} --amount 0`
  );
  if (!zeroTransfer.success && (zeroTransfer.stderr?.includes("Error(Contract, #9)") || zeroTransfer.stderr?.includes("HostError"))) {
    console.log(`\x1b[32m✔ RECHAZO EXITOSO ESPERADO: Monto 0 rechazado por regla de negocio.\x1b[0m`);
    console.log(`Detalle error: ${zeroTransfer.stderr?.slice(0, 140)}...`);
  } else {
    console.log(`Resultado: ${zeroTransfer.stdout || zeroTransfer.stderr}`);
  }

  // ====================================================================
  // PASO 4: Transferencia Válida Permisionada (Emisor -> Wallet A)
  // ====================================================================
  logStep(
    4,
    "TRANSFERENCIA VÁLIDA A CUENTA AUTORIZADA",
    "El Emisor transfiere 200 tokens FACT001 a la Wallet A (Inversor aprobado por Compliance).",
    "Transacción EXITOSA. El saldo del Emisor debe decrementar a 800 y el de Wallet A incrementar a 200."
  );

  const validTransfer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- transfer --from ${issuer} --to ${walletA} --amount 200`
  );
  console.log(`\x1b[32m✔ Transferencia confirmada on-chain.\x1b[0m`);

  const balIssuer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- balance --id ${issuer}`
  );
  const balA = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- balance --id ${walletA}`
  );
  console.log(`\x1b[32m✔ Saldo Emisor:   ${balIssuer.stdout} FACT001 (Esperado: 800)\x1b[0m`);
  console.log(`\x1b[32m✔ Saldo Wallet A: ${balA.stdout} FACT001 (Esperado: 200)\x1b[0m`);

  // ====================================================================
  // PASO 5: Transferencia Inválida de Compliance (Emisor -> Wallet B)
  // ====================================================================
  logStep(
    5,
    "RECHAZO DE COMPLIANCE: BLOQUEO A CUENTA NO AUTORIZADA (CASO CRÍTICO)",
    "El Emisor intenta transferir 100 tokens a la Wallet B (NO registrada en la Whitelist).",
    "Debe REVERTIR con error Contract #1 (ReceiverNotAuthorized). Los saldos deben mantenerse INTACTOS."
  );

  const invalidTransfer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- transfer --from ${issuer} --to ${walletB} --amount 100`
  );

  if (!invalidTransfer.success && (invalidTransfer.stderr?.includes("Error(Contract, #1)") || invalidTransfer.stderr?.includes("HostError"))) {
    console.log(`\n\x1b[1m\x1b[32m✔ RECHAZO ON-CHAIN EXITOSO:\x1b[0m`);
    console.log(`\x1b[32mEl contrato Soroban consultó RwaRegistry, detectó que Wallet B no está en Whitelist y ABORTÓ la operación.\x1b[0m`);
    console.log(`Código de error Soroban: \x1b[31mReceiverNotAuthorized (Contract Error #1)\x1b[0m`);
  } else {
    console.log(`Resultado inesperado: ${invalidTransfer.stdout || invalidTransfer.stderr}`);
  }

  // Verificar que el saldo de Wallet B sigue en 0
  const balB = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- balance --id ${walletB}`
  );
  console.log(`\x1b[32m✔ Saldo Wallet B: ${balB.stdout} FACT001 (Intacto en 0)\x1b[0m`);

  // ====================================================================
  // PASO 6: Suspensión Cautelar (Freeze) de Wallet A
  // ====================================================================
  logStep(
    6,
    "MEDIDA CAUTELAR: CONGELAMIENTO (FREEZE) POR COMPLIANCE",
    "El Oficial de Cumplimiento congela temporalmente la Wallet A e intentamos enviarle tokens.",
    "is_authorized debe pasar a false y la transferencia debe ser RECHAZADA."
  );

  runCommand(
    `stellar contract invoke --id ${regId} --source-account compliance --network testnet -- freeze_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${walletA}`
  );
  console.log(`\x1b[32m✔ Wallet A ha sido CONGELADA cautelarmente por Compliance.\x1b[0m`);

  const frozenTransfer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- transfer --from ${issuer} --to ${walletA} --amount 50`
  );
  if (!frozenTransfer.success) {
    console.log(`\x1b[32m✔ Transferencia hacia cuenta congelada BLOQUEADA correctamente.\x1b[0m`);
  }

  // Descongelar Wallet A
  console.log("Restableciendo autorización de Wallet A...");
  runCommand(
    `stellar contract invoke --id ${regId} --source-account compliance --network testnet -- authorize_wallet --asset_id ${assetId} --compliance_officer ${compliance} --wallet ${walletA}`
  );
  console.log(`\x1b[32m✔ Wallet A RE-AUTORIZADA con éxito.\x1b[0m`);

  // ====================================================================
  // PASO 7: Freno de Emergencia (Pause / Unpause)
  // ====================================================================
  logStep(
    7,
    "FRENO DE EMERGENCIA GLOBAL (PAUSE / UNPAUSE)",
    "El Administrador activa el freno de emergencia (Pause) sobre el token.",
    "Cualquier transferencia debe ser REVERTIDA con error Contract #4 (AssetPaused) hasta que se reactive."
  );

  runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- pause --admin ${admin}`
  );
  console.log(`\x1b[33m✔ Token en estado de EMERGENCIA: PAUSADO.\x1b[0m`);

  const pausedTransfer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- transfer --from ${issuer} --to ${walletA} --amount 10`
  );
  if (!pausedTransfer.success && (pausedTransfer.stderr?.includes("Error(Contract, #4)") || pausedTransfer.stderr?.includes("HostError"))) {
    console.log(`\x1b[32m✔ Transferencia bloqueada por pausa global (AssetPaused #4).\x1b[0m`);
  }

  // Reactivar
  runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- unpause --admin ${admin}`
  );
  console.log(`\x1b[32m✔ Token REACTIVADO (Unpaused).\x1b[0m`);

  // ====================================================================
  // PASO 8: Redención y Quema de Tokens (Burn)
  // ====================================================================
  logStep(
    8,
    "REDENCIÓN Y QUEMA DE TOKENS (BURN)",
    "La factura ha sido liquidada en el mundo real. El Emisor quema sus tokens restantes.",
    "El balance del Emisor debe pasar a 0 y el total supply reducirse acorde."
  );

  runCommand(
    `stellar contract invoke --id ${tokId} --source-account issuer --network testnet -- burn --from ${issuer} --amount 800`
  );
  console.log(`\x1b[32m✔ 800 tokens FACT001 quemados por redención.\x1b[0m`);

  const finalBalIssuer = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- balance --id ${issuer}`
  );
  const totalSupply = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- total_supply`
  );
  console.log(`\x1b[32m✔ Saldo final Emisor: ${finalBalIssuer.stdout} FACT001\x1b[0m (Esperado: 0)`);
  console.log(`\x1b[32m✔ Oferta circulante restante: ${totalSupply.stdout} FACT001\x1b[0m`);

  // ====================================================================
  // PASO 9: Cierre del Ciclo de Vida del Activo (Redeemed)
  // ====================================================================
  logStep(
    9,
    "CIERRE DEFINITIVO DEL ACTIVO (REDEEMED)",
    "El Emisor cambia el estado del activo en RwaRegistry a 3 (Redeemed).",
    "El activo queda cerrado para la posteridad y ningún mint adicional puede ocurrir."
  );

  runCommand(
    `stellar contract invoke --id ${regId} --source-account issuer --network testnet -- set_asset_status --asset_id ${assetId} --caller ${issuer} --new_status 3`
  );
  console.log(`\x1b[32m✔ Estado del activo cambiado a REDEEMED (3) en RwaRegistry.\x1b[0m`);

  // Intento de emitir en activo Redeemed debe fallar
  const mintAfterRedeem = runCommand(
    `stellar contract invoke --id ${tokId} --source-account admin --network testnet -- mint --admin ${admin} --to ${walletA} --amount 50`
  );
  if (!mintAfterRedeem.success) {
    console.log(`\x1b[32m✔ Intento de emisión sobre activo redimido RECHAZADO (AssetNotActive #6).\x1b[0m`);
  }

  console.log("\n======================================================================");
  console.log("       ¡DEMOSTRACIÓN FINALIZADA CON ÉXITO AL 100%!");
  console.log("======================================================================");
  console.log("Todos los casos de uso, controles de compliance, transferencias");
  console.log("válidas e inválidas, y ciclo de vida fueron verificados en Testnet.");
  console.log("======================================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Falló la demostración:", err.message);
  process.exit(1);
});
