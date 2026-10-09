// Interacción directa con los contratos Soroban: el usuario firma cada transacción con Freighter.
// El backend nunca tiene claves; solo recibe el hash de la transacción ya confirmada.
import { signTransaction } from "@stellar/freighter-api";
import { Account, Address, BASE_FEE, Contract, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface ChainConfig {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  registryContractId: string;
  adminAddress: string;
}

export type ContractKind = "registry" | "token";

const registryErrors: Record<number, string> = {
  1: "AssetAlreadyExists: Ya existe un activo registrado con ese símbolo.",
  2: "AssetNotFound: El activo no existe en RwaRegistry.",
  3: "Unauthorized: Tu wallet no tiene el rol necesario (emisor o compliance) para esta operación.",
  4: "InvalidStatusTransition: Transición de estado no permitida para el activo.",
  6: "DocumentNotFound: El documento no existe.",
  7: "IssuerNotApproved: Tu wallet no está aprobada como emisor. Solicita la aprobación al administrador de la plataforma.",
  8: "InvalidMaxSupply: El suministro máximo debe ser mayor a 0."
};

const tokenErrors: Record<number, string> = {
  1: "ReceiverNotAuthorized: La dirección de destino no está autorizada por Compliance para este activo.",
  2: "SenderNotAuthorized: La cuenta de origen no está autorizada por Compliance para este activo.",
  3: "WalletFrozen: La cuenta se encuentra congelada preventivamente por Compliance.",
  4: "AssetPaused: Las operaciones del activo están pausadas.",
  5: "InsufficientBalance: Saldo insuficiente para esta operación.",
  6: "AssetNotActive: El activo no está en estado Activo.",
  9: "InvalidAmount: El monto debe ser mayor a 0.",
  10: "MaxSupplyExceeded: La emisión supera el suministro máximo del activo.",
  11: "IssuerNotApproved: El emisor del activo ya no está aprobado por la plataforma."
};

/** Convierte los errores del simulador/RPC en mensajes legibles con el código de contrato. */
export function describeChainError(error: unknown, kind: ContractKind): Error {
  const text = error instanceof Error ? error.message : String(error);
  const contractCode = text.match(/Error\(Contract, #(\d+)\)/);
  if (contractCode) {
    const code = Number(contractCode[1]);
    const message = (kind === "registry" ? registryErrors : tokenErrors)[code];
    if (message) return new Error(`${message} (Error on-chain #${code})`);
    return new Error(`StellarContractError: Error on-chain #${code}`);
  }
  if (/Error\(Auth,/.test(text)) return new Error("AuthError: La firma no corresponde a la cuenta que debe autorizar esta operación.");
  if (/User declined|rejected/i.test(text)) return new Error("Firma cancelada en Freighter.");
  return new Error(text.length > 300 ? `${text.slice(0, 300)}…` : text);
}

// ---------------------------------------------------------------------------
// Conversión de argumentos
// ---------------------------------------------------------------------------

export const scv = {
  address: (value: string) => new Address(value).toScVal(),
  symbol: (value: string) => nativeToScVal(value, { type: "symbol" }),
  string: (value: string) => nativeToScVal(value, { type: "string" }),
  u32: (value: number) => nativeToScVal(value, { type: "u32" }),
  u64: (value: number | bigint) => nativeToScVal(BigInt(value), { type: "u64" }),
  i128: (value: number | bigint) => nativeToScVal(BigInt(value), { type: "i128" }),
  bytes32: (hex: string) => {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("El hash debe ser un SHA-256 de 64 caracteres hexadecimales.");
    return xdr.ScVal.scvBytes(hexToBytes(hex));
  },
  /** Struct de Soroban: mapa con claves Symbol ordenadas alfabéticamente. */
  struct: (fields: Record<string, xdr.ScVal>) =>
    xdr.ScVal.scvMap(
      Object.keys(fields)
        .sort()
        .map((key) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }))
    )
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Lectura y escritura
// ---------------------------------------------------------------------------

export class SorobanGateway {
  private readonly server: rpc.Server;

  constructor(readonly config: ChainConfig) {
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  }

  private build(source: Account, contractId: string, method: string, args: xdr.ScVal[]) {
    return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.config.networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60)
      .build();
  }

  /** Consulta de solo lectura (simulación, sin firma ni comisión). */
  async read<T = unknown>(contractId: string, method: string, args: xdr.ScVal[], kind: ContractKind): Promise<T> {
    // La simulación no valida la secuencia: basta una cuenta existente como fuente
    const source = new Account(this.config.adminAddress, "0");
    const simulation = await this.server.simulateTransaction(this.build(source, contractId, method, args));
    if (rpc.Api.isSimulationError(simulation)) throw describeChainError(simulation.error, kind);
    const retval = simulation.result?.retval;
    return (retval ? scValToNative(retval) : undefined) as T;
  }

  /** Simula, pide la firma a Freighter, envía y espera la confirmación. */
  async invoke<T = unknown>(
    signer: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    kind: ContractKind
  ): Promise<{ txHash: string; result: T }> {
    let prepared;
    try {
      const account = await this.server.getAccount(signer);
      prepared = await this.server.prepareTransaction(this.build(account, contractId, method, args));
    } catch (error) {
      throw describeChainError(error, kind);
    }

    const signed = await signTransaction(prepared.toXDR(), {
      networkPassphrase: this.config.networkPassphrase,
      address: signer
    });
    if (signed.error) throw describeChainError(signed.error.message ?? String(signed.error), kind);

    const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, this.config.networkPassphrase);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      throw describeChainError(`La red rechazó la transacción ${sent.hash} (${sent.status}).`, kind);
    }

    const final = await this.server.pollTransaction(sent.hash, { attempts: 30 });
    if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw describeChainError(`La transacción ${sent.hash} terminó con estado ${final.status}`, kind);
    }
    const result = (final.returnValue ? scValToNative(final.returnValue) : undefined) as T;
    return { txHash: sent.hash, result };
  }
}
