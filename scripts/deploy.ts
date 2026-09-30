import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const wasmRegistry = path.join(rootDir, "contracts", "target", "wasm32v1-none", "release", "rwa_registry.wasm");
const wasmToken = path.join(rootDir, "contracts", "target", "wasm32v1-none", "release", "rwa_token.wasm");

function runCommand(command: string): string {
  console.log(`\x1b[36m> ${command}\x1b[0m`);
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
    return output.trim();
  } catch (error: any) {
    console.error(`\x1b[31mError ejecutando: ${command}\x1b[0m`);
    if (error.stderr) console.error(`\x1b[31m${error.stderr}\x1b[0m`);
    if (error.stdout) console.log(error.stdout);
    throw error;
  }
}

async function main() {
  console.log("\n=======================================================");
  console.log("       ASSETRA - DESPLIEGUE EN STELLAR TESTNET");
  console.log("=======================================================\n");

  // 1. Verificar archivos WASM
  if (!fs.existsSync(wasmRegistry) || !fs.existsSync(wasmToken)) {
    console.log("Compilando contratos con target wasm32v1-none...");
    runCommand("cargo build --target wasm32v1-none --release --jobs 1 --manifest-path contracts/Cargo.toml");
  } else {
    console.log("Binarios WASM encontrados y listos para despliegue.");
  }

  // 2. Obtener clave de cuenta administradora
  console.log("\n[1/4] Verificando cuenta administradora...");
  const adminAddress = runCommand("stellar keys address admin");
  console.log(`Dirección Admin: ${adminAddress}`);

  console.log("Fondeando cuenta admin en Testnet...");
  runCommand("stellar keys fund admin --network testnet");

  // 3. Desplegar RwaRegistry
  console.log("\n[2/4] Desplegando RwaRegistry en Stellar Testnet...");
  const registryContractId = runCommand(
    `stellar contract deploy --wasm "${wasmRegistry}" --source-account admin --network testnet`
  );
  console.log(`\x1b[32m✔ RwaRegistry desplegado con ID: ${registryContractId}\x1b[0m`);

  // 4. Desplegar PermissionedRwaToken
  console.log("\n[3/4] Desplegando PermissionedRwaToken en Stellar Testnet...");
  const tokenContractId = runCommand(
    `stellar contract deploy --wasm "${wasmToken}" --source-account admin --network testnet`
  );
  console.log(`\x1b[32m✔ PermissionedRwaToken desplegado con ID: ${tokenContractId}\x1b[0m`);

  // 5. Inicializar PermissionedRwaToken vinculando RwaRegistry
  console.log("\n[4/4] Inicializando PermissionedRwaToken vinculando RwaRegistry...");
  runCommand(
    `stellar contract invoke --id ${tokenContractId} --source-account admin --network testnet -- initialize --admin ${adminAddress} --registry ${registryContractId} --asset_id FACT001 --decimals 0 --name "Factura Comercial 001" --symbol FACT001`
  );
  console.log("\x1b[32m✔ Token inicializado correctamente.\x1b[0m");

  // 6. Guardar artefacto contracts.json
  const deploymentInfo = {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    registryContractId,
    tokenContractId,
    adminAddress,
    assetId: "FACT001",
    deployedAt: new Date().toISOString(),
    explorers: {
      registry: `https://stellar.expert/explorer/testnet/contract/${registryContractId}`,
      token: `https://stellar.expert/explorer/testnet/contract/${tokenContractId}`
    }
  };

  const contractsJsonPath = path.join(rootDir, "contracts.json");
  fs.writeFileSync(contractsJsonPath, JSON.stringify(deploymentInfo, null, 2), "utf8");
  console.log(`\n\x1b[32m✔ Archivo de entrega contracts.json generado en: ${contractsJsonPath}\x1b[0m`);

  // 7. Actualizar backend/.env si existe
  const backendEnvPath = path.join(rootDir, "backend", ".env");
  if (fs.existsSync(backendEnvPath)) {
    let envContent = fs.readFileSync(backendEnvPath, "utf8");
    envContent = envContent.replace(/RWA_REGISTRY_CONTRACT_ID=.*/g, `RWA_REGISTRY_CONTRACT_ID=${registryContractId}`);
    envContent = envContent.replace(/PERMISSIONED_TOKEN_CONTRACT_ID=.*/g, `PERMISSIONED_TOKEN_CONTRACT_ID=${tokenContractId}`);
    fs.writeFileSync(backendEnvPath, envContent, "utf8");
    console.log("✔ Variables de entorno actualizadas en backend/.env");
  }

  console.log("\n=======================================================");
  console.log("            ¡DESPLIEGUE FINALIZADO CON ÉXITO!");
  console.log("=======================================================");
  console.log(`RwaRegistry:  ${registryContractId}`);
  console.log(`              ${deploymentInfo.explorers.registry}`);
  console.log(`RwaToken:     ${tokenContractId}`);
  console.log(`              ${deploymentInfo.explorers.token}`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Falló el despliegue:", err.message);
  process.exit(1);
});
