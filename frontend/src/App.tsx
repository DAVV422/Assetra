import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, ArrowRight, BadgeCheck, Ban, Blocks, ChevronRight, CircleDollarSign,
  FileCheck2, FilePlus2, Fingerprint, Menu, Pause, Play,
  Plus, RefreshCw, ShieldCheck, Sparkles, UserCheck, UserPlus, Users, X
} from "lucide-react";
import { OrbitalLines } from "./components/OrbitalLines";
import { assetraClient } from "./lib/client";
import type {
  Asset, AssetStatus, AssetType, CreateAssetInput, LifecycleAction, ParticipantStatus
} from "./types";

type View = "dashboard" | "assets" | "participants" | "documents" | "create";

const statusLabels: Record<AssetStatus, string> = {
  draft: "Borrador", active: "Activo", paused: "Pausado", redeemed: "Redimido"
};
const participantLabels: Record<ParticipantStatus, string> = {
  pending: "Pendiente", authorized: "Autorizado", suspended: "Suspendido"
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
    <div className="brand-mark" aria-label="Assetra">
      <span>A</span><span>S</span>
    </div>
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

function AssetCard({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const progress = Math.round((asset.mintedSupply / asset.supply) * 100);
  return (
    <button className="asset-card" onClick={onOpen}>
      <div className="asset-card-top">
        <div className="asset-monogram">{asset.symbol.slice(0, 2)}</div>
        <div><span className="micro-label">{typeLabels[asset.type]}</span><h3>{asset.name}</h3></div>
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

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("asset-invoice-091");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => assets.find((asset) => asset.id === selectedId) ?? assets[0], [assets, selectedId]);

  useEffect(() => {
    assetraClient.listAssets()
      .then((data) => { setAssets(data); if (data[0] && !data.some((item) => item.id === selectedId)) setSelectedId(data[0].id); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const navigate = (next: View) => {
    setView(next); setMenuOpen(false); setError(null); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const replaceAsset = (asset: Asset) => setAssets((current) => current.map((item) => item.id === asset.id ? asset : item));

  const openAsset = (asset: Asset) => {
    setSelectedId(asset.id); navigate("assets");
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
              <PageHeading eyebrow="CONTROL DE CICLO DE VIDA" title="Activos" copy="Selecciona un activo para consultar su respaldo, suministro, participantes y controles administrativos." action={<button className="primary" onClick={() => navigate("create")}><Plus size={18} /> Nuevo activo</button>} />
              <div className="asset-grid compact-grid">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setSelectedId(asset.id)} />)}</div>
              {selected && <AssetDetail asset={selected} busy={busy} onAction={runAction} />}
            </section>
          )}

          {view === "participants" && selected && (
            <ParticipantsView assets={assets} selected={selected} onSelect={setSelectedId} onChanged={refreshSelected} onToast={setToast} />
          )}

          {view === "documents" && selected && (
            <DocumentsView assets={assets} selected={selected} onSelect={setSelectedId} onChanged={refreshSelected} onToast={setToast} />
          )}

          {view === "create" && (
            <CreateAssetView onCancel={() => navigate("dashboard")} onCreated={(asset) => { setAssets((items) => [asset, ...items]); setSelectedId(asset.id); setToast("Activo creado como borrador"); navigate("assets"); }} />
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

function AssetDetail({ asset, busy, onAction }: { asset: Asset; busy: boolean; onAction: (action: LifecycleAction, amount?: number) => void }) {
  const [amount, setAmount] = useState(100);
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
          <label><span>CANTIDAD</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
          <div className="action-grid">
            <button disabled={busy || asset.status === "redeemed"} onClick={() => onAction("mint", amount)}><Plus /> Mint</button>
            <button disabled={busy || !asset.mintedSupply} onClick={() => onAction("burn", amount)}><Ban /> Burn</button>
            {asset.status === "paused"
              ? <button disabled={busy} onClick={() => onAction("unpause")}><Play /> Reactivar</button>
              : <button disabled={busy || asset.status === "redeemed"} onClick={() => onAction("pause")}><Pause /> Pausar</button>}
            <button className="danger" disabled={busy || asset.status === "redeemed"} onClick={() => onAction("redeem")}><RefreshCw /> Redimir</button>
          </div>
        </div>
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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await assetraClient.addParticipant(selected.id, { ...form, status: "pending" });
      await onChanged(); setForm({ name: "", wallet: "", jurisdiction: "Bolivia" }); onToast("Participante registrado como pendiente");
    } finally { setBusy(false); }
  };
  const changeStatus = async (participantId: string, status: ParticipantStatus) => {
    setBusy(true); try { await assetraClient.updateParticipantStatus(selected.id, participantId, status); await onChanged(); onToast(`Estado actualizado: ${participantLabels[status]}`); } finally { setBusy(false); }
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
                  {participant.status !== "authorized" && <button disabled={busy} onClick={() => changeStatus(participant.id, "authorized")}>Autorizar</button>}
                  {participant.status === "authorized" && <button disabled={busy} onClick={() => changeStatus(participant.id, "suspended")}>Suspender</button>}
                </div>
              </div>
            ))}
          </div> : <EmptyState title="Sin participantes" copy="Registra la primera wallet autorizada." />}
        </div>
        <form className="side-form" onSubmit={submit}>
          <div className="form-icon"><UserPlus /></div><h2>Nuevo participante</h2><p>Los datos son simulados. La información personal nunca se almacena on-chain.</p>
          <label><span>NOMBRE O ENTIDAD</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Aya Capital" /></label>
          <label><span>WALLET STELLAR</span><input required minLength={8} value={form.wallet} onChange={(event) => setForm({ ...form, wallet: event.target.value })} placeholder="G..." /></label>
          <label><span>JURISDICCIÓN</span><input required value={form.jurisdiction} onChange={(event) => setForm({ ...form, jurisdiction: event.target.value })} /></label>
          <button className="primary full" disabled={busy}>{busy ? "Registrando…" : "Registrar participante"}<ArrowRight size={18} /></button>
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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await assetraClient.addDocument(selected.id, { ...form, version: 1 });
      await onChanged(); setForm({ name: "", kind: "Factura", hash: "", url: "" }); onToast("Hash del documento registrado");
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
          <div className="form-icon"><FilePlus2 /></div><h2>Registrar documento</h2><p>Ingresa un hash generado fuera de Assetra. Este MVP no carga información sensible.</p>
          <label><span>NOMBRE</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Factura comercial 091" /></label>
          <label><span>TIPO</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option>Factura</option><option>Custodia</option><option>Auditoría</option><option>Contrato legal</option></select></label>
          <label><span>HASH SHA-256</span><input required minLength={8} className="mono" value={form.hash} onChange={(event) => setForm({ ...form, hash: event.target.value })} placeholder="a47f8c0d..." /></label>
          <label><span>URL OPCIONAL</span><input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://..." /></label>
          <button className="primary full" disabled={busy}>{busy ? "Registrando…" : "Registrar huella"}<ArrowRight size={18} /></button>
        </form>
      </div>
    </section>
  );
}

function CreateAssetView({ onCancel, onCreated }: { onCancel: () => void; onCreated: (asset: Asset) => void }) {
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
    try { onCreated(await assetraClient.createAsset(form)); }
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
          <label><span>VALOR TOTAL</span><input required type="number" min="1" value={form.totalValue} onChange={(event) => update("totalValue", Number(event.target.value))} /></label>
          <label><span>MONEDA</span><select value={form.currency} onChange={(event) => update("currency", event.target.value)}><option>USDC</option><option>USD</option><option>EUR</option></select></label>
          <label><span>SUMINISTRO MÁXIMO</span><input required type="number" min="1" value={form.supply} onChange={(event) => update("supply", Number(event.target.value))} /></label>
          <label><span>FECHA DE VENCIMIENTO</span><input required type="date" value={form.maturityDate} onChange={(event) => update("maturityDate", event.target.value)} /></label>
          <div className="calculation-card span-2"><Sparkles /><div><span>CADA TOKEN REPRESENTA</span><b>{money(form.totalValue / Math.max(form.supply, 1), form.currency)}</b><small>Valor referencial del MVP</small></div></div>
        </div>}
        {step === 3 && <div className="form-grid">
          <label className="span-2"><span>ENTIDAD EMISORA</span><input required value={form.issuer} onChange={(event) => update("issuer", event.target.value)} placeholder="Andina Export SRL" /></label>
          <label><span>CUSTODIO / VERIFICADOR</span><input required value={form.custodian} onChange={(event) => update("custodian", event.target.value)} placeholder="Demo Custody" /></label>
          <label><span>JURISDICCIÓN</span><input required value={form.jurisdiction} onChange={(event) => update("jurisdiction", event.target.value)} /></label>
          <div className="notice span-2"><ShieldCheck /><p><b>Modo compliance-ready.</b> El activo se creará como borrador permissioned. Después podrás registrar documentos y autorizar participantes.</p></div>
        </div>}
        {formError && <div className="form-error"><Ban size={17} />{formError}</div>}
        <div className="form-footer"><button type="button" className="secondary" onClick={step === 1 ? onCancel : () => { setFormError(null); setStep(step - 1); }}>{step === 1 ? "Cancelar" : "Atrás"}</button>{step < 3 ? <button type="button" className="primary" onClick={continueToNextStep}>Continuar <ArrowRight size={18} /></button> : <button className="primary" disabled={busy}>{busy ? "Creando…" : "Crear activo"}<ArrowRight size={18} /></button>}</div>
      </form>
    </section>
  );
}
