import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowRight, BadgeCheck, Ban, Blocks, ChevronRight, CircleDollarSign,
  ExternalLink, FileCheck2, FilePlus2, FileText, FileUp, Fingerprint, Globe, Lock, Menu, Pause, Play,
  Plus, RefreshCw, Send, Server, ShieldAlert, ShieldCheck, Snowflake, Sparkles, UserCheck, UserPlus, Users, Wallet, X
} from "lucide-react";
import {
  getAddress as getFreighterAddress,
  isConnected as isFreighterConnected,
  requestAccess as requestFreighterAccess
} from "@stellar/freighter-api";
import { OrbitalLines } from "./components/OrbitalLines";
import assetraLogo from "./assetra-logo.png";
import { apiUrl, assetraClient, checkBackendHealth, getClientMode, isOnChainMode, setActiveWallet, setClientMode, type ClientMode } from "./lib/client";
import { cacheCustomAssetLocally, getCachedCustomAssets } from "./lib/http-client";
import type {
  Asset, AssetStatus, AssetType, CreateAssetInput, LifecycleAction, ParticipantStatus, TransferResult
} from "./types";


type View = "dashboard" | "assets" | "participants" | "documents" | "create";

const statusLabels: Record<AssetStatus, string> = {
  draft: "Borrador", active: "Activo", paused: "Pausado", redeemed: "Redimido"
};
const participantLabels: Record<ParticipantStatus, string> = {
  pending: "Pendiente", authorized: "Autorizado", revoked: "Revocado", frozen: "Congelado"
};
const typeLabels: Record<AssetType, string> = {
  invoice: "Factura", bond: "Bono", "real-estate": "Inmueble", commodity: "Commodity", "carbon-credit": "Crédito de carbono"
};


const money = (value: number, currency = "USD") => {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return `${new Intl.NumberFormat("es-BO", { maximumFractionDigits: 0 }).format(value)} ${code}`;
  }
  return new Intl.NumberFormat("es-BO", {
    style: "currency", currency: code, maximumFractionDigits: 0
  }).format(value);
};
const date = (value: string) => new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

function Mark() {
  return (
    <img className="brand-logo" src={assetraLogo} alt="Assetra" />
  );
}

function StatusPill({ status }: { status: AssetStatus }) {
  return <span className={`status-pill status-${status}`}><i />{statusLabels[status]}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span className="micro-label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function AssetCard({ asset, onOpen, isMine }: { asset: Asset; onOpen: () => void; isMine?: boolean }) {
  const progress = Math.round((asset.mintedSupply / asset.supply) * 100);
  return (
    <button className="asset-card" onClick={onOpen}>
      <div className="asset-card-top">
        <div className="asset-monogram">{asset.symbol.slice(0, 2)}</div>
        <div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span className="micro-label">{typeLabels[asset.type]}</span>
            {isMine && <span className="ownership-badge" style={{ padding: "2px 6px", fontSize: "8px" }}>Tuyo</span>}
          </div>
          <h3>{asset.name}</h3>
        </div>
        <StatusPill status={asset.status} />
      </div>
      <p>{asset.description}</p>
      <div className="asset-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="asset-card-metrics">
        <span><small>VALOR</small><b>{money(asset.totalValue, asset.currency)}</b></span>
        <span><small>EMITIDO</small><b>{progress}%</b></span>
        <span><small>HOLDERS</small><b>{asset.holderCount}</b></span>
      </div>
      <div className="card-link">Administrar activo <ArrowRight size={17} /></div>
    </button>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><Blocks size={30} /><h3>{title}</h3><p>{copy}</p></div>;
}

// Wallet ficticia solo para el modo simulación (no existe on-chain)
const DEMO_WALLET = "GDEMOWALLETASSETRASIMULACIONSINFIRMAREALXXXXXXXXXXXXXXXX";

const getMyCreatedAssetIds = (): string[] => {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem("assetra_my_created_asset_ids");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const addMyCreatedAssetId = (id: string) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getMyCreatedAssetIds();
    if (!current.includes(id)) {
      current.push(id);
      window.localStorage.setItem("assetra_my_created_asset_ids", JSON.stringify(current));
    }
  } catch {
    // ignore
  }
};

export default function App() {
  const [view, setView] = useState<View>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("assetra_current_view") as View | null;
      if (saved && ["dashboard", "assets", "participants", "documents", "create"].includes(saved)) {
        return saved;
      }
    }
    return "dashboard";
  });
  const [assets, setAssets] = useState<Asset[]>(() => {
    return getCachedCustomAssets();
  });
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("assetra_selected_asset_id") || "asset-invoice-091";
    }
    return "asset-invoice-091";
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("assetra_connected_wallet");
    }
    return null;
  });
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [clientMode, setClientModeState] = useState<ClientMode>(getClientMode());
  const [filterScope, setFilterScope] = useState<"all" | "mine">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("assetra_filter_scope") as "all" | "mine" | null;
      if (saved === "all" || saved === "mine") return saved;
    }
    return "all";
  });
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "draft" | "paused">("all");

  const isMyAsset = (asset: Asset, userWallet: string | null): boolean => {
    if (getMyCreatedAssetIds().includes(asset.id)) return true;
    if (!userWallet) return false;
    const w = userWallet.trim().toLowerCase();
    if (asset.creatorWallet && asset.creatorWallet.toLowerCase() === w) return true;
    if (asset.issuer.toLowerCase() === w) return true;
    if (asset.complianceOfficer && asset.complianceOfficer.toLowerCase() === w) return true;
    if (asset.participants && asset.participants.some((p) => p.wallet.toLowerCase() === w)) return true;
    return false;
  };

  const myAssets = useMemo(() => {
    return assets.filter((asset) => isMyAsset(asset, wallet));
  }, [assets, wallet]);

  const displayedAssets = useMemo(() => {
    let list = filterScope === "mine" ? myAssets : assets;
    if (filterStatus !== "all") {
      list = list.filter((a) => a.status === filterStatus);
    }
    return list;
  }, [filterScope, filterStatus, assets, myAssets]);

  const selected = useMemo(() => {
    return displayedAssets.find((asset) => asset.id === selectedId) ?? displayedAssets[0] ?? assets[0];
  }, [displayedAssets, selectedId, assets]);

  useEffect(() => {
    // Se espera al health check: define si el modo API opera on-chain (backend live) o simulado
    checkBackendHealth().then((res) => {
      if (res.ok && clientMode === "http") {
        setToast(res.mode === "live" ? `Modo on-chain: firmas con Freighter (API ${apiUrl})` : `Conectado a API mock en ${apiUrl}`);
      }
    }).then(() => assetraClient.listAssets())
      .then((data) => {
        setAssets(data);
        if (data[0] && !data.some((item) => item.id === selectedId)) {
          setSelectedId(data[0].id);
        }
      })
      .catch((reason: Error) => {
        const cached = getCachedCustomAssets();
        if (cached.length > 0) {
          setAssets(cached);
        } else {
          setError(reason.message);
        }
      })
      .finally(() => setLoading(false));
  }, [clientMode]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const toggleClientMode = async () => {
    if (clientMode === "mock") {
      setLoading(true);
      setError(null);
      const health = await checkBackendHealth();
      if (!health.ok) {
        setLoading(false);
        setError(`No se detectó el backend en ${apiUrl}. Inícialo con "npm run dev -w backend" o ejecuta "npm run dev" en la raíz.`);
        return;
      }
      setClientMode("http");
      setClientModeState("http");
      try {
        const data = await assetraClient.listAssets();
        setAssets(data);
        if (data[0]) setSelectedId(data[0].id);
        setToast("Conectado a Live API (Backend Express en puerto 4000)");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al conectar con API");
      } finally {
        setLoading(false);
      }
    } else {
      setClientMode("mock");
      setClientModeState("mock");
      setLoading(true);
      setError(null);
      try {
        const data = await assetraClient.listAssets();
        setAssets(data);
        if (data[0]) setSelectedId(data[0].id);
        setToast("Modo MOCK (Simulación local) activado");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al activar modo mock");
      } finally {
        setLoading(false);
      }
    }
  };


  const updateWallet = (newWallet: string | null) => {
    setWallet(newWallet);
    setActiveWallet(newWallet);
    if (typeof window !== "undefined") {
      if (newWallet) {
        localStorage.setItem("assetra_connected_wallet", newWallet);
      } else {
        localStorage.removeItem("assetra_connected_wallet");
      }
    }
  };

  const selectAsset = (id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("assetra_selected_asset_id", id);
    }
  };

  const changeFilterScope = (scope: "all" | "mine") => {
    setFilterScope(scope);
    if (typeof window !== "undefined") {
      localStorage.setItem("assetra_filter_scope", scope);
    }
  };

  // Sin Freighter solo se puede simular: en modo on-chain cada operación requiere la firma real
  const useDemoWallet = () => {
    if (isOnChainMode()) {
      setError("No se detectó Freighter. Instala la extensión y selecciona la red Testnet para firmar operaciones on-chain.");
      return;
    }
    updateWallet(DEMO_WALLET);
    setToast("Freighter no detectado: conectada wallet demo (modo simulación)");
  };

  const connectFreighter = async () => {
    setWalletConnecting(true);
    try {
      const isAvailable = await isFreighterConnected();
      const hasFreighter = typeof isAvailable === "object" ? !!isAvailable?.isConnected : !!isAvailable;
      if (hasFreighter) {
        const accessObj = await requestFreighterAccess();
        const addr = typeof accessObj === "object" ? accessObj?.address : accessObj;
        if (addr) {
          updateWallet(addr);
          setToast("Wallet Freighter conectada correctamente");
          return;
        }
        const directAddr = await getFreighterAddress();
        const direct = typeof directAddr === "object" ? directAddr?.address : directAddr;
        if (direct) {
          updateWallet(direct);
          setToast("Wallet Freighter conectada correctamente");
          return;
        }
      }
      useDemoWallet();
    } catch {
      useDemoWallet();
    } finally {
      setWalletConnecting(false);
    }
  };

  const disconnectWallet = () => {
    updateWallet(null);
    setToast("Wallet desconectada");
  };

  const navigate = (next: View) => {
    setView(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("assetra_current_view", next);
    }
    setMenuOpen(false);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const replaceAsset = (asset: Asset) => setAssets((current) => current.map((item) => item.id === asset.id ? asset : item));

  const openAsset = (asset: Asset) => {
    selectAsset(asset.id);
    navigate("assets");
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const updated = await assetraClient.getAsset(selected.id);
    replaceAsset(updated);
  };

  const runAction = async (action: LifecycleAction, amount?: number) => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const updated = await assetraClient.runLifecycleAction(selected.id, { action, amount });
      replaceAsset(updated);
      setToast(`Operación ${action} registrada correctamente`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible completar la operación");
    } finally { setBusy(false); }
  };

  const totalValue = assets.reduce((sum, asset) => sum + asset.totalValue, 0);
  const activeCount = assets.filter((asset) => asset.status === "active").length;
  const participantCount = assets.reduce((sum, asset) => sum + asset.participants.length, 0);
  const documentCount = assets.reduce((sum, asset) => sum + asset.documents.length, 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("dashboard")}><Mark /><span className="brand-words">TOKENIZAR<br />VERIFICAR<br />MOVER</span></button>
        <nav className={menuOpen ? "main-nav open" : "main-nav"}>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}>RESUMEN</button>
          <button className={view === "assets" ? "active" : ""} onClick={() => navigate("assets")}>ACTIVOS</button>
          <button className={view === "participants" ? "active" : ""} onClick={() => navigate("participants")}>PARTICIPANTES</button>
          <button className={view === "documents" ? "active" : ""} onClick={() => navigate("documents")}>DOCUMENTOS</button>
        </nav>
        <div className="topbar-actions">
          <span className="network-pill"><i /> STELLAR TESTNET</span>
          <button
            type="button"
            className={`mode-toggle-btn mode-${clientMode}`}
            onClick={toggleClientMode}
            title={clientMode === "http" ? `API activa en ${apiUrl}. Clic para alternar a MOCK` : "Clic para conectar con Backend Live API"}
          >
            <Server size={13} />
            {clientMode === "http" && <span className="dot-live" />}
            <span>{clientMode === "http" ? "API LIVE (4000)" : "MODO: MOCK"}</span>
          </button>
          {wallet ? (

            <div className="wallet-pill" title={wallet}>
              <i />
              <span>{wallet.slice(0, 4)}...{wallet.slice(-4)}</span>
              <button className="disconnect-btn" onClick={disconnectWallet} title="Desconectar wallet">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="wallet-btn" onClick={connectFreighter} disabled={walletConnecting}>
              <Wallet size={15} />
              {walletConnecting ? "Conectando…" : "Conectar Freighter"}
            </button>
          )}
          <button className="primary compact" onClick={() => navigate("create")}><Plus size={18} /> Crear activo</button>
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir menú">{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      {loading ? <div className="loading-screen"><Mark /><span>Cargando infraestructura…</span></div> : (
        <main>
          {error && <div className="error-banner"><Ban size={18} /><span>{error}</span><button onClick={() => setError(null)}><X size={16} /></button></div>}
          {view === "dashboard" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="eyebrow">INFRAESTRUCTURA RWA / STELLAR</span>
                  <h1>ACTIVOS REALES.<br /><em>REGLAS VERIFICABLES.</em></h1>
                  <p>Emite y administra activos permissioned con identidad, documentos verificables y control programable de todo su ciclo de vida.</p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => navigate("create")}>Crear primer activo <ArrowRight size={19} /></button>
                    <button className="secondary" onClick={() => navigate("assets")}>Explorar activos</button>
                  </div>
                </div>
                <div className="hero-art"><OrbitalLines /><div className="hero-wordmark">ASSET<span>·</span>RA</div></div>
              </section>

              <section className="metrics-grid">
                <Metric label="VALOR REGISTRADO" value={money(totalValue)} note="Activos ficticios del MVP" />
                <Metric label="ACTIVOS OPERATIVOS" value={`${activeCount}/${assets.length}`} note="En Stellar Testnet" />
                <Metric label="PARTICIPANTES" value={String(participantCount)} note="Identidades registradas" />
                <Metric label="DOCUMENTOS" value={String(documentCount)} note="Hashes verificables" />
              </section>

              <section className="content-section">
                <div className="section-heading"><div><span className="eyebrow">PORTAFOLIO</span><h2>Activos en operación</h2></div><button className="text-button" onClick={() => navigate("assets")}>Ver todos <ArrowRight size={17} /></button></div>
                <div className="asset-grid">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => openAsset(asset)} />)}</div>
              </section>

              <section className="process-strip">
                <div><span>01</span><Fingerprint /><b>REGISTRA</b><small>Activo y respaldo</small></div>
                <ChevronRight />
                <div><span>02</span><UserCheck /><b>AUTORIZA</b><small>Participantes</small></div>
                <ChevronRight />
                <div><span>03</span><CircleDollarSign /><b>EMITE</b><small>Tokens RWA</small></div>
                <ChevronRight />
                <div><span>04</span><RefreshCw /><b>ADMINISTRA</b><small>Ciclo de vida</small></div>
              </section>
            </>
          )}

          {view === "assets" && (
            <section className="page-section">
              <PageHeading
                eyebrow="CONTROL DE CICLO DE VIDA"
                title="Activos"
                copy="Selecciona un activo para consultar su respaldo, suministro, participantes y controles administrativos."
                action={<button className="primary" onClick={() => navigate("create")}><Plus size={18} /> Nuevo activo</button>}
              />

              <div className="catalog-toolbar">
                <div className="filter-scope-group">
                  <button
                    className={`scope-pill ${filterScope === "all" ? "active" : ""}`}
                    onClick={() => changeFilterScope("all")}
                  >
                    <Globe size={15} /> Catálogo Global ({assets.length})
                  </button>
                  <button
                    className={`scope-pill ${filterScope === "mine" ? "active" : ""}`}
                    onClick={() => changeFilterScope("mine")}
                  >
                    <UserCheck size={15} /> Mis Activos ({myAssets.length})
                  </button>
                </div>

                <div className="filter-status-group">
                  {(["all", "active", "draft", "paused"] as const).map((st) => (
                    <button
                      key={st}
                      className={`status-chip ${filterStatus === st ? "active" : ""}`}
                      onClick={() => setFilterStatus(st)}
                    >
                      {st === "all" ? "Todos" : statusLabels[st as AssetStatus] ?? st}
                    </button>
                  ))}
                </div>
              </div>

              {filterScope === "mine" && !wallet && myAssets.length === 0 ? (
                <div className="wallet-prompt-box">
                  <Wallet size={28} />
                  <div>
                    <h4>Conecta tu wallet para gestionar tus activos</h4>
                    <p>Visualiza tus emisiones, participaciones y activos en borrador privados.</p>
                  </div>
                  <button className="primary" onClick={connectFreighter} disabled={walletConnecting}>
                    {walletConnecting ? "Conectando..." : "Conectar Freighter"}
                  </button>
                </div>
              ) : displayedAssets.length === 0 ? (
                <div className="empty-assets-box">
                  <FileText size={28} />
                  <h4>No se encontraron activos</h4>
                  <p>{filterScope === "mine" ? "No tienes activos registrados todavía en este navegador." : "No hay activos disponibles con el filtro actual."}</p>
                  <button className="primary" onClick={() => navigate("create")}><Plus size={16} /> Registrar nuevo activo</button>
                </div>
              ) : (
                <>
                  {filterScope === "mine" && !wallet && myAssets.length > 0 && (
                    <div className="wallet-prompt-box" style={{ marginBottom: "1rem" }}>
                      <Wallet size={24} />
                      <div>
                        <h4>Wallet no vinculada en esta sesión</h4>
                        <p>Tus activos creados están listados a continuación. Conecta Freighter para firmar nuevas emisiones o transferencias.</p>
                      </div>
                      <button className="primary" onClick={connectFreighter} disabled={walletConnecting}>
                        {walletConnecting ? "Conectando..." : "Conectar Freighter"}
                      </button>
                    </div>
                  )}

                  <div className="asset-grid compact-grid">
                    {displayedAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        isMine={isMyAsset(asset, wallet)}
                        onOpen={() => selectAsset(asset.id)}
                      />
                    ))}
                  </div>

                  {selected && (
                    <AssetDetail
                      asset={selected}
                      busy={busy}
                      connectedWallet={wallet}
                      onAction={runAction}
                      onTransferSuccess={refreshSelected}
                      onNavigateToParticipants={() => navigate("participants")}
                    />
                  )}
                </>
              )}
            </section>
          )}


          {view === "participants" && selected && (
            <ParticipantsView assets={assets} selected={selected} onSelect={selectAsset} onChanged={refreshSelected} onToast={setToast} />
          )}

          {view === "documents" && selected && (
            <DocumentsView assets={assets} selected={selected} onSelect={selectAsset} onChanged={refreshSelected} onToast={setToast} />
          )}

          {view === "create" && (
            <CreateAssetView
              connectedWallet={wallet}
              onCancel={() => navigate("dashboard")}
              onCreated={(asset) => {
                addMyCreatedAssetId(asset.id);
                cacheCustomAssetLocally(asset);
                setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
                selectAsset(asset.id);
                changeFilterScope("mine");
                setToast("Activo creado como borrador");
                navigate("assets");
              }}
            />
          )}
        </main>
      )}

      <footer><div><Mark /><b>ASSETRA</b></div><p>Infraestructura RWA sobre Stellar · MVP Testnet 2026</p><span>UN ACTIVO. UNA REGLA. UN REGISTRO.</span></footer>
      {toast && <div className="toast"><BadgeCheck size={20} />{toast}</div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function AssetPicker({ assets, selected, onSelect }: { assets: Asset[]; selected: Asset; onSelect: (id: string) => void }) {
  return (
    <label className="asset-picker"><span>ACTIVO SELECCIONADO</span>
      <select value={selected.id} onChange={(event) => onSelect(event.target.value)}>
        {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.symbol}</option>)}
      </select>
    </label>
  );
}

function AssetDetail({
  asset,
  busy,
  connectedWallet,
  onAction,
  onTransferSuccess,
  onNavigateToParticipants
}: {
  asset: Asset;
  busy: boolean;
  connectedWallet: string | null;
  onAction: (action: LifecycleAction, amount?: number) => void;
  onTransferSuccess: () => Promise<void>;
  onNavigateToParticipants: () => void;
}) {
  const [amount, setAmount] = useState(100);
  const [transferFrom, setTransferFrom] = useState(connectedWallet || asset.issuer);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState(50);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const onChain = isOnChainMode();

  useEffect(() => {
    if (connectedWallet) {
      setTransferFrom(connectedWallet);
    }
  }, [connectedWallet]);

  const handleTransfer = async (e: FormEvent) => {
    e.preventDefault();
    setTransferBusy(true);
    setTransferResult(null);
    setTransferError(null);
    try {
      const res = await assetraClient.transferTokens(asset.id, {
        from: (onChain ? connectedWallet ?? "" : transferFrom).trim(),
        to: transferTo.trim(),
        amount: Number(transferAmount)
      });
      setTransferResult(res);
      await onTransferSuccess();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Error al procesar la transferencia");
    } finally {
      setTransferBusy(false);
    }
  };

  const percent = Math.round((asset.mintedSupply / asset.supply) * 100);
  return (
    <article className="detail-panel">
      <div className="detail-title">
        <div><span className="eyebrow">ADMINISTRAR / {asset.symbol}</span><h2>{asset.name}</h2><p>{asset.description}</p></div>
        <StatusPill status={asset.status} />
      </div>
      <div className="detail-metrics">
        <div><span>SUMINISTRO</span><b>{asset.supply.toLocaleString("es-BO")}</b><small>{asset.symbol}</small></div>
        <div><span>EMITIDO</span><b>{asset.mintedSupply.toLocaleString("es-BO")}</b><small>{percent}% del total</small></div>
        <div><span>VENCIMIENTO</span><b>{date(asset.maturityDate)}</b><small>{asset.jurisdiction}</small></div>
        <div><span>DOCUMENTOS</span><b>{asset.documents.length}</b><small>versiones registradas</small></div>
      </div>
      <div className="detail-columns">
        <div className="info-block">
          <h3><ShieldCheck size={20} /> Respaldo del activo</h3>
          <dl>
            <div><dt>Emisor</dt><dd>{asset.issuer}</dd></div>
            <div><dt>Custodio</dt><dd>{asset.custodian}</dd></div>
            <div><dt>Jurisdicción</dt><dd>{asset.jurisdiction}</dd></div>
            <div><dt>Contract ID</dt><dd className="mono">{asset.contractId ?? "Pendiente de despliegue"}</dd></div>
          </dl>
        </div>
        <div className="action-block">
          <h3><Activity size={20} /> Controles administrativos</h3>
          <label><span>CANTIDAD</span><input type="number" min="1" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} /></label>
          {onChain && <p className="transfer-subtitle">Cada acción se firma con tu wallet. Mint, estado y documentos los firma el emisor del activo.</p>}
          <div className="action-grid">
            {asset.status === "draft" && <button disabled={busy} onClick={() => onAction("activate")}><Play /> Activar</button>}
            <button disabled={busy || asset.status === "redeemed"} onClick={() => onAction("mint", amount)}><Plus /> Mint</button>
            <button disabled={busy || !asset.mintedSupply} onClick={() => onAction("burn", amount)}><Ban /> Burn</button>
            {asset.status === "paused"
              ? <button disabled={busy} onClick={() => onAction("unpause")}><Play /> Reactivar</button>
              : <button disabled={busy || asset.status === "redeemed"} onClick={() => onAction("pause")}><Pause /> Pausar</button>}
            <button className="danger" disabled={busy || asset.status === "redeemed"} onClick={() => onAction("redeem")}><RefreshCw /> Redimir</button>
          </div>
        </div>
      </div>

      {/* Permissioned Token Transfer Panel */}
      <div className="transfer-block">
        <h3><Send size={19} /> Transferencia de Tokens RWA (Permissioned Transfer)</h3>
        <p className="transfer-subtitle">
          Los tokens RWA emitidos en Stellar Testnet están gobernados por el contrato inteligente <code>PermissionedRwaToken</code>. Solo participantes autorizados por Compliance pueden recibir fondos.
        </p>

        <form onSubmit={handleTransfer}>
          <div className="transfer-grid">
            <label>
              <span>CUENTA ORIGEN</span>
              <input
                required
                className="mono"
                value={onChain ? connectedWallet ?? "" : transferFrom}
                readOnly={onChain}
                onChange={(e) => setTransferFrom(e.target.value)}
                placeholder={onChain ? "Conecta Freighter para firmar" : "Dirección Stellar G... o Emisor"}
              />
            </label>

            <label>
              <span>DIRECCIÓN DESTINO (RECEIVER)</span>
              <input
                required
                className="mono"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="Pega wallet G... o selecciona abajo"
              />
              <div className="transfer-quick-select">
                {asset.participants.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`transfer-pill-btn pill-${p.status}`}
                    onClick={() => setTransferTo(p.wallet)}
                    title={`${p.name} (${participantLabels[p.status]})`}
                  >
                    {p.status === "frozen" && <Snowflake size={11} />}
                    {p.status === "revoked" && <Ban size={11} />}
                    {p.status === "pending" && <Lock size={11} />}
                    {p.status === "authorized" && <BadgeCheck size={11} />}
                    <span>{p.name.split(" ")[0]} ({participantLabels[p.status]})</span>
                  </button>
                ))}
                {!onChain && (
                  <button
                    type="button"
                    className="transfer-pill-btn pill-revoked"
                    onClick={() => setTransferTo("GDESCONOCIDA999NOAUTORIZADAXASSETRA")}
                    title="Probar wallet no autorizada"
                  >
                    <ShieldAlert size={11} /> Wallet No Registrada
                  </button>
                )}
              </div>
            </label>

            <label>
              <span>CANTIDAD ({asset.symbol})</span>
              <input
                required
                type="number"
                min="1"
                max={asset.mintedSupply || 100000}
                value={transferAmount || ""}
                onChange={(e) => setTransferAmount(Number(e.target.value))}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={transferBusy || asset.status !== "active" || asset.mintedSupply <= 0}
            >
              <Send size={16} />
              {transferBusy ? "Validando…" : "Transferir"}
            </button>
          </div>
        </form>

        {/* Success Feedback Banner */}
        {transferResult && (
          <div className="transfer-alert-success">
            <h4><BadgeCheck size={18} /> Transferencia Autorizada y Confirmada</h4>
            <p>
              Se enviaron <b>{transferResult.amount} {asset.symbol}</b> a la cuenta <span className="mono">{transferResult.to}</span>. La verificación de Compliance on-chain concluyó con éxito.
            </p>
            <div className="transfer-alert-actions">
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${transferResult.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                <ExternalLink size={13} />
                Ver en Stellar Expert ({transferResult.txHash.slice(0, 12)}...)
              </a>
              <button
                type="button"
                className="btn-compliance-action"
                onClick={() => setTransferResult(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Rejection Feedback Banner */}
        {transferError && (
          <div className="transfer-alert-error">
            <div className="rejection-header">
              <span className="rejection-badge">
                <ShieldAlert size={14} /> Rechazo de Regla On-Chain
              </span>
              <span className="mono" style={{ fontSize: "11px", color: "var(--red)", fontWeight: "bold" }}>
                {transferError.includes("ReceiverNotAuthorized")
                  ? "ERROR: ReceiverNotAuthorized"
                  : transferError.includes("SenderNotAuthorized")
                  ? "ERROR: SenderNotAuthorized"
                  : transferError.includes("InsufficientBalance")
                  ? "ERROR: InsufficientBalance"
                  : transferError.includes("WalletFrozen")
                  ? "ERROR: WalletFrozen"
                  : transferError.includes("AssetNotActive")
                  ? "ERROR: AssetNotActive"
                  : transferError.includes("AssetPaused")
                  ? "ERROR: AssetPaused"
                  : transferError.includes("Freighter")
                  ? "FIRMA CANCELADA"
                  : "ERROR: ComplianceRuleViolation"}
              </span>
            </div>
            <h4>Transacción Bloqueada por Smart Contract de Assetra</h4>
            <p>{transferError}</p>
            <div className="transfer-alert-actions">
              <button
                type="button"
                className="btn-compliance-action"
                onClick={onNavigateToParticipants}
              >
                <UserCheck size={14} />
                Gestionar Whitelist en Participantes
              </button>
              <button
                type="button"
                className="btn-compliance-action"
                onClick={() => setTransferError(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="activity-list">
        <h3>Actividad reciente</h3>
        {asset.activity.length ? asset.activity.map((event) => (
          <div key={event.id}><span className="activity-icon"><Activity size={16} /></span><div><b>{event.label}</b><small>{event.actor} · {date(event.timestamp)}</small></div><span className="mono">{event.txHash ?? "OFF-CHAIN"}</span></div>
        )) : <EmptyState title="Sin actividad" copy="Las operaciones aparecerán aquí." />}
      </div>
    </article>
  );
}


function ParticipantsView({ assets, selected, onSelect, onChanged, onToast }: {
  assets: Asset[]; selected: Asset; onSelect: (id: string) => void; onChanged: () => Promise<void>; onToast: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: "", wallet: "", jurisdiction: "Bolivia" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const onChain = isOnChainMode();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError(null);
    try {
      await assetraClient.addParticipant(selected.id, { ...form, status: "pending" });
      await onChanged(); setForm({ name: "", wallet: "", jurisdiction: "Bolivia" });
      onToast(onChain ? "Participante autorizado on-chain por Compliance" : "Participante registrado como pendiente");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "No fue posible registrar el participante");
    } finally { setBusy(false); }
  };
  const changeStatus = async (participantId: string, status: ParticipantStatus) => {
    setBusy(true); setFormError(null);
    try { await assetraClient.updateParticipantStatus(selected.id, participantId, status); await onChanged(); onToast(`Estado actualizado: ${participantLabels[status]}`); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : "No fue posible actualizar el estado"); }
    finally { setBusy(false); }
  };
  return (
    <section className="page-section">
      <PageHeading eyebrow="IDENTIDAD Y COMPLIANCE" title="Participantes" copy="Administra qué wallets pueden recibir y transferir cada activo permissioned." />
      <AssetPicker assets={assets} selected={selected} onSelect={onSelect} />
      <div className="workspace-grid">
        <div className="table-card">
          <div className="table-title"><div><Users /><h2>Registro de identidades</h2></div><span>{selected.participants.length} PARTICIPANTES</span></div>
          {selected.participants.length ? <div className="data-table">
            {selected.participants.map((participant) => (
              <div className="data-row" key={participant.id}>
                <div className="avatar">{participant.name.slice(0, 2).toUpperCase()}</div>
                <div><b>{participant.name}</b><small className="mono">{participant.wallet}</small></div>
                <span>{participant.jurisdiction}</span>
                <span className={`participant-status participant-${participant.status}`}>{participantLabels[participant.status]}</span>
                <div className="row-actions">
                  {participant.status === "pending" && (
                    <>
                      <button className="btn-auth" disabled={busy} onClick={() => changeStatus(participant.id, "authorized")}>Autorizar</button>
                      <button className="btn-revoke" disabled={busy} onClick={() => changeStatus(participant.id, "revoked")}>Rechazar</button>
                    </>
                  )}
                  {participant.status === "authorized" && (
                    <>
                      <button className="btn-freeze" disabled={busy} onClick={() => changeStatus(participant.id, "frozen")}>Congelar</button>
                      <button className="btn-revoke" disabled={busy} onClick={() => changeStatus(participant.id, "revoked")}>Revocar</button>
                    </>
                  )}
                  {participant.status === "frozen" && (
                    <>
                      <button className="btn-auth" disabled={busy} onClick={() => changeStatus(participant.id, "authorized")}>Descongelar</button>
                      <button className="btn-revoke" disabled={busy} onClick={() => changeStatus(participant.id, "revoked")}>Revocar</button>
                    </>
                  )}
                  {participant.status === "revoked" && (
                    <button className="btn-auth" disabled={busy} onClick={() => changeStatus(participant.id, "authorized")}>Re-autorizar</button>
                  )}
                </div>
              </div>
            ))}
          </div> : <EmptyState title="Sin participantes" copy="Registra la primera wallet autorizada." />}
        </div>
        <form className="side-form" onSubmit={submit}>
          <div className="form-icon"><UserPlus /></div><h2>Nuevo participante</h2>
          <p>{onChain
            ? "Registrar un participante lo autoriza en la whitelist on-chain: lo firma el oficial de compliance del activo. Nombre y jurisdicción nunca se almacenan on-chain."
            : "Los datos son simulados. La información personal nunca se almacena on-chain."}</p>
          <label><span>NOMBRE O ENTIDAD</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Aya Capital" /></label>
          <label><span>WALLET STELLAR</span><input required minLength={8} value={form.wallet} onChange={(event) => setForm({ ...form, wallet: event.target.value })} placeholder="G..." /></label>
          <label><span>JURISDICCIÓN</span><input required value={form.jurisdiction} onChange={(event) => setForm({ ...form, jurisdiction: event.target.value })} /></label>
          {formError && <div className="form-error"><Ban size={17} />{formError}</div>}
          <button className="primary full" disabled={busy}>{busy ? (onChain ? "Esperando firma…" : "Registrando…") : onChain ? "Autorizar participante" : "Registrar participante"}<ArrowRight size={18} /></button>
        </form>
      </div>
    </section>
  );
}

function DocumentsView({ assets, selected, onSelect, onChanged, onToast }: {
  assets: Asset[]; selected: Asset; onSelect: (id: string) => void; onChanged: () => Promise<void>; onToast: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: "", kind: "Factura", hash: "", url: "" });
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [calculatingHash, setCalculatingHash] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = async (file: File) => {
    setCalculatingHash(true);
    try {
      const buffer = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest("SHA-256", buffer);
      const hashHex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setFileName(file.name);
      setForm((current) => ({
        ...current,
        name: current.name || file.name.replace(/\.[^/.]+$/, ""),
        hash: hashHex
      }));
      onToast("Hash SHA-256 calculado localmente desde el archivo");
    } catch {
      onToast("Error al procesar el archivo");
    } finally {
      setCalculatingHash(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const [formError, setFormError] = useState<string | null>(null);
  const onChain = isOnChainMode();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError(null);
    try {
      // En modo on-chain la versión la asigna el contrato (1, 2, 3…)
      await assetraClient.addDocument(selected.id, { ...form, version: selected.documents.length + 1 });
      await onChanged(); setForm({ name: "", kind: "Factura", hash: "", url: "" }); setFileName(null);
      onToast(onChain ? "Hash del documento registrado on-chain" : "Hash del documento registrado");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "No fue posible registrar el documento");
    } finally { setBusy(false); }
  };
  return (
    <section className="page-section">
      <PageHeading eyebrow="PRUEBAS VERIFICABLES" title="Documentos" copy="Mantén el archivo fuera de la blockchain y registra su huella, versión y referencia." />
      <AssetPicker assets={assets} selected={selected} onSelect={onSelect} />
      <div className="workspace-grid">
        <div className="table-card">
          <div className="table-title"><div><FileCheck2 /><h2>Registro documental</h2></div><span>{selected.documents.length} ARCHIVOS</span></div>
          {selected.documents.length ? <div className="document-grid">
            {selected.documents.map((document) => (
              <article key={document.id}><div className="doc-icon"><FileCheck2 /></div><span className="micro-label">{document.kind} · V{document.version}</span><h3>{document.name}</h3><p className="mono">{document.hash}</p><small>Registrado {date(document.createdAt)}</small></article>
            ))}
          </div> : <EmptyState title="Sin documentos" copy="Registra el documento que respalda este activo." />}
        </div>
        <form className="side-form" onSubmit={submit}>
          <div className="form-icon"><FilePlus2 /></div><h2>Registrar documento</h2><p>Calcula el hash SHA-256 desde un PDF local o ingresa la huella manualmente.</p>

          {/* Client-side PDF SHA-256 Drag & Drop */}
          <div
            className={`dropzone ${isDragging ? "active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  processFile(e.target.files[0]);
                }
              }}
            />
            <FileUp size={24} />
            <b>{calculatingHash ? "Calculando SHA-256…" : fileName ? `PDF: ${fileName}` : "Seleccionar o arrastrar PDF aquí"}</b>
            <p>El archivo nunca sale de tu navegador. Calculamos la huella SHA-256 con Web Crypto API.</p>
            {form.hash && (
              <div className="hash-calculated">
                <BadgeCheck size={14} /> SHA-256: {form.hash.slice(0, 20)}...
              </div>
            )}
          </div>

          <label><span>NOMBRE</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Factura comercial 091" /></label>
          <label><span>TIPO</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option>Factura</option><option>Custodia</option><option>Auditoría</option><option>Contrato legal</option></select></label>
          <label><span>HASH SHA-256</span><input required minLength={onChain ? 64 : 8} maxLength={onChain ? 64 : undefined} pattern={onChain ? "[0-9a-fA-F]{64}" : undefined} className="mono" value={form.hash} onChange={(event) => setForm({ ...form, hash: event.target.value })} placeholder="a47f8c0d..." /></label>
          <label><span>URL OPCIONAL</span><input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://..." /></label>
          {formError && <div className="form-error"><Ban size={17} />{formError}</div>}
          <button className="primary full" disabled={busy}>{busy ? (onChain ? "Esperando firma…" : "Registrando…") : "Registrar huella"}<ArrowRight size={18} /></button>
        </form>
      </div>
    </section>
  );
}


function CreateAssetView({
  connectedWallet,
  onCancel,
  onCreated,
}: {
  connectedWallet?: string | null;
  onCancel: () => void;
  onCreated: (asset: Asset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateAssetInput>({
    name: "", symbol: "", type: "invoice", description: "", issuer: "", custodian: "",
    jurisdiction: "Bolivia", totalValue: 100000, currency: "USDC", supply: 1000, maturityDate: "2026-12-20"
  });
  const update = <K extends keyof CreateAssetInput>(key: K, value: CreateAssetInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const continueToNextStep = () => {
    if (step === 1 && (!form.name.trim() || form.symbol.trim().length < 2 || form.description.trim().length < 10)) {
      setFormError("Completa el nombre, un símbolo de al menos 2 caracteres y una descripción de al menos 10 caracteres."); return;
    }
    if (step === 2 && (form.totalValue <= 0 || form.supply <= 0 || !form.maturityDate)) {
      setFormError("El valor, el suministro y la fecha de vencimiento deben ser válidos."); return;
    }
    setFormError(null); setStep(step + 1);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    if (!form.issuer.trim() || !form.custodian.trim() || !form.jurisdiction.trim()) {
      setFormError("Completa la entidad emisora, el custodio y la jurisdicción."); setBusy(false); return;
    }
    try {
      const storedWallet = typeof window !== "undefined" ? localStorage.getItem("assetra_connected_wallet") : null;
      const effectiveWallet = connectedWallet || storedWallet;
      const payload: CreateAssetInput = {
        ...form,
        creatorWallet: effectiveWallet ?? undefined,
      };
      onCreated(await assetraClient.createAsset(payload));
    }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : "No fue posible crear el activo"); }
    finally { setBusy(false); }
  };
  return (
    <section className="create-page">
      <div className="create-intro"><span className="eyebrow">ASSET FACTORY / TESTNET</span><h1>Convierte un derecho real en un activo administrable.</h1><p>Este flujo registra la información tecnológica del activo. No crea una estructura legal, custodia real ni una inversión.</p><div className="step-list"><button className={step === 1 ? "active" : ""} onClick={() => setStep(1)}><span>01</span><b>Activo</b><small>Qué representa</small></button><button className={step === 2 ? "active" : ""} onClick={() => setStep(2)}><span>02</span><b>Emisión</b><small>Valor y suministro</small></button><button className={step === 3 ? "active" : ""} onClick={() => setStep(3)}><span>03</span><b>Responsables</b><small>Emisor y custodio</small></button></div></div>
      <form className="create-form" onSubmit={submit}>
        <div className="form-header"><div><span>PASO {String(step).padStart(2, "0")} / 03</span><h2>{step === 1 ? "Información del activo" : step === 2 ? "Economía de la emisión" : "Responsables y jurisdicción"}</h2></div><button type="button" onClick={onCancel}><X /></button></div>
        {step === 1 && <div className="form-grid">
          <label className="span-2"><span>NOMBRE DEL ACTIVO</span><input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Factura Andina 091" /></label>
          <label><span>SÍMBOLO</span><input required maxLength={12} value={form.symbol} onChange={(event) => update("symbol", event.target.value.toUpperCase())} placeholder="AINV91" /></label>
          <label><span>TIPO</span><select value={form.type} onChange={(event) => update("type", event.target.value as AssetType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="span-2"><span>DESCRIPCIÓN DEL DERECHO REPRESENTADO</span><textarea required minLength={10} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe exactamente qué derecho representa el token…" /></label>
        </div>}
        {step === 2 && <div className="form-grid">
          <label><span>VALOR TOTAL</span><input required type="number" min="1" value={form.totalValue || ""} onChange={(event) => update("totalValue", Number(event.target.value))} /></label>
          <label><span>MONEDA</span><select value={form.currency} onChange={(event) => update("currency", event.target.value)}><option>USDC</option><option>USD</option><option>EUR</option></select></label>
          <label><span>SUMINISTRO MÁXIMO</span><input required type="number" min="1" value={form.supply || ""} onChange={(event) => update("supply", Number(event.target.value))} /></label>
          <label><span>FECHA DE VENCIMIENTO</span><input required type="date" value={form.maturityDate} onChange={(event) => update("maturityDate", event.target.value)} /></label>
          <div className="calculation-card span-2"><Sparkles /><div><span>CADA TOKEN REPRESENTA</span><b>{money(form.totalValue / Math.max(form.supply, 1), form.currency)}</b><small>Valor referencial del MVP</small></div></div>
        </div>}
        {step === 3 && <div className="form-grid">
          <label className="span-2"><span>ENTIDAD EMISORA</span><input required value={form.issuer} onChange={(event) => update("issuer", event.target.value)} placeholder="Andina Export SRL" /></label>
          <label><span>CUSTODIO / VERIFICADOR</span><input required value={form.custodian} onChange={(event) => update("custodian", event.target.value)} placeholder="Demo Custody" /></label>
          <label><span>JURISDICCIÓN</span><input required value={form.jurisdiction} onChange={(event) => update("jurisdiction", event.target.value)} /></label>
          <div className="notice span-2"><ShieldCheck /><p>{isOnChainMode()
            ? <><b>Firma on-chain.</b> Tu wallet firmará <code>create_asset</code>: se registra el activo y se despliega su token con suministro máximo {form.supply.toLocaleString("es-BO")}. Tu wallet debe estar aprobada como emisor por el administrador de la plataforma y quedará como emisor y oficial de compliance del activo.</>
            : <><b>Modo compliance-ready.</b> El activo se creará como borrador permissioned. Después podrás registrar documentos y autorizar participantes.</>}</p></div>
        </div>}
        {formError && <div className="form-error"><Ban size={17} />{formError}</div>}
        <div className="form-footer"><button type="button" className="secondary" onClick={step === 1 ? onCancel : () => { setFormError(null); setStep(step - 1); }}>{step === 1 ? "Cancelar" : "Atrás"}</button>{step < 3 ? <button type="button" className="primary" onClick={continueToNextStep}>Continuar <ArrowRight size={18} /></button> : <button className="primary" disabled={busy}>{busy ? "Creando…" : "Crear activo"}<ArrowRight size={18} /></button>}</div>
      </form>
    </section>
  );
}
