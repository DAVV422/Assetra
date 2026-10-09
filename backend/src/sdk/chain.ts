// Acceso de solo lectura a Soroban. El backend NO tiene claves: consulta los contratos por
// simulación y verifica transacciones que firmaron los usuarios con su propia wallet.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";

export interface ChainSettings {
  rpcUrl: string;
  networkPassphrase: string;
  /** Cuenta existente usada solo como fuente de simulaciones (no firma nada). */
  readSource: string;
}

export interface VerifiedTx {
  hash: string;
  source: string;
  contract: string;
  fn: string;
  args: unknown[];
  timestamp: string;
}

export interface TxExpectation {
  contract: string;
  fns: string[];
  signers?: string[];
  /** Para llamadas al registro: el primer argumento debe ser este asset_id. */
  assetId?: string;
}

export const scv = {
  address: (value: string) => new Address(value).toScVal(),
  symbol: (value: string) => nativeToScVal(value, { type: "symbol" }),
  u32: (value: number) => nativeToScVal(value, { type: "u32" })
};

export class ChainError extends Error {
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
  }
}

export class ChainReader {
  private readonly server: rpc.Server;

  constructor(private readonly settings: ChainSettings) {
    this.server = new rpc.Server(settings.rpcUrl, { allowHttp: settings.rpcUrl.startsWith("http://") });
  }

  async read<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.settings.readSource, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.settings.networkPassphrase
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const simulation = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new ChainError("StellarContractError", `${method}: ${simulation.error.split("\n")[0]}`);
    }
    const retval = simulation.result?.retval;
    return (retval ? scValToNative(retval) : undefined) as T;
  }

  /** Comprueba que la transacción existe, fue exitosa y corresponde a la operación esperada. */
  async verifyTx(hash: string, expect: TxExpectation): Promise<VerifiedTx> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ChainError("INVALID_TX_HASH", "hash de transacción inválido");

    const response = await this.server.getTransaction(hash);
    if (response.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new ChainError("TX_NOT_CONFIRMED", `la transacción ${hash} no está confirmada como exitosa (${response.status})`);
    }

    let tx = TransactionBuilder.fromXDR(response.envelopeXdr.toXdr("base64"), this.settings.networkPassphrase);
    if (tx instanceof FeeBumpTransaction) tx = tx.innerTransaction;

    const op = tx.operations[0];
    if (tx.operations.length !== 1 || op?.type !== "invokeHostFunction") {
      throw new ChainError("TX_MISMATCH", "la transacción no es una invocación de contrato");
    }
    const func = op.func;
    if (func.type !== "hostFunctionTypeInvokeContract") {
      throw new ChainError("TX_MISMATCH", "la transacción no invoca un contrato");
    }

    const invocation = func.invokeContract;
    const contract = Address.fromScAddress(invocation.contractAddress).toString();
    const fn = invocation.functionName.toString();
    const args = invocation.args.map((arg: xdr.ScVal) => scValToNative(arg));
    const source = tx.source;

    if (contract !== expect.contract || !expect.fns.includes(fn)) {
      throw new ChainError("TX_MISMATCH", `se esperaba ${expect.fns.join("/")} en ${expect.contract}`);
    }
    if (expect.assetId !== undefined && args[0] !== expect.assetId) {
      throw new ChainError("TX_MISMATCH", "la transacción corresponde a otro activo");
    }
    if (expect.signers && !expect.signers.includes(source)) {
      throw new ChainError("TX_MISMATCH", "la transacción no fue firmada por una cuenta con el rol requerido");
    }

    return { hash, source, contract, fn, args, timestamp: new Date(Number(response.createdAt) * 1000).toISOString() };
  }
}
