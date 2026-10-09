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

  // 1. Compilar siempre: cargo es incremental y así nunca se despliega un WASM desactualizado
  console.log("Compilando contratos con target wasm32v1-none...");
  runCommand("cargo build --target wasm32v1-none --release --jobs 1 --manifest-path contracts/Cargo.toml");
  if (!fs.existsSync(wasmRegistry) || !fs.existsSync(wasmToken)) {
    throw new Error("No se encontraron los binarios WASM tras la compilación.");
  }

  // 2. Obtener clave de cuenta administradora
  console.log("\n[1/3] Verificando cuenta administradora...");
  const adminAddress = runCommand("stellar keys address admin");
  console.log(`Dirección Admin: ${adminAddress}`);

  console.log("Fondeando cuenta admin en Testnet...");
  runCommand("stellar keys fund admin --network testnet");

  // 3. Subir el WASM del token: RwaRegistry lo usa para desplegar un token por cada activo
  console.log("\n[2/3] Subiendo WASM de PermissionedRwaToken...");
  const tokenWasmHash = runCommand(
    `stellar contract upload --wasm "${wasmToken}" --source-account admin --network testnet`
  );
  console.log(`\x1b[32m✔ WASM del token instalado con hash: ${tokenWasmHash}\x1b[0m`);

  // 4. Desplegar RwaRegistry. El constructor fija admin y WASM del token en la misma transacción
  console.log("\n[3/3] Desplegando RwaRegistry (registro + factory de tokens)...");
  const registryContractId = runCommand(
    `stellar contract deploy --wasm "${wasmRegistry}" --source-account admin --network testnet -- --admin ${adminAddress} --token_wasm_hash ${tokenWasmHash}`
  );
  console.log(`\x1b[32m✔ RwaRegistry desplegado con ID: ${registryContractId}\x1b[0m`);

  // 5. Guardar artefacto contracts.json (los tokens se crean por activo; `script:seed` añade el de FACT001)
  const deploymentInfo = {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    registryContractId,
    tokenWasmHash,
    tokenContractId: "",
    adminAddress,
    assetId: "FACT001",
    deployedAt: new Date().toISOString(),
    explorers: {
      registry: `https://stellar.expert/explorer/testnet/contract/${registryContractId}`
    }
  };

  // Se escribe también backend/contracts.json: es la copia que se empaqueta en la imagen Docker (Koyeb)
  for (const contractsJsonPath of [path.join(rootDir, "contracts.json"), path.join(rootDir, "backend", "contracts.json")]) {
    fs.writeFileSync(contractsJsonPath, JSON.stringify(deploymentInfo, null, 2), "utf8");
    console.log(`\n\x1b[32m✔ Archivo de entrega contracts.json generado en: ${contractsJsonPath}\x1b[0m`);
  }

  // 6. Actualizar backend/.env si existe
  const backendEnvPath = path.join(rootDir, "backend", ".env");
  if (fs.existsSync(backendEnvPath)) {
    let envContent = fs.readFileSync(backendEnvPath, "utf8");
    envContent = envContent.replace(/RWA_REGISTRY_CONTRACT_ID=.*/g, `RWA_REGISTRY_CONTRACT_ID=${registryContractId}`);
    fs.writeFileSync(backendEnvPath, envContent, "utf8");
    console.log("✔ Variables de entorno actualizadas en backend/.env");
  }

  console.log("\n=======================================================");
  console.log("            ¡DESPLIEGUE FINALIZADO CON ÉXITO!");
  console.log("=======================================================");
  console.log(`RwaRegistry:  ${registryContractId}`);
  console.log(`              ${deploymentInfo.explorers.registry}`);
  console.log(`Token WASM:   ${tokenWasmHash}`);
  console.log("Siguiente paso: npm run script:seed");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Falló el despliegue:", err.message);
  process.exit(1);
});
