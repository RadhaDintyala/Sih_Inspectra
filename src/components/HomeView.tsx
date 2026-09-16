"use client";

import { ArrowUpRight, Camera, Clock3, ChevronRight, Lock, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import type { Inspection } from "@/domain/inspection";
import { statusLabel } from "@/components/utils";
import type { UserRole } from "@/context/RoleContext";

function HistoryRow({ item, onClick }: { item: Inspection; onClick: () => void }) {
  return (
    <button className="mini-history" onClick={onClick}>
      <span className="status-dot" />
      <span>
        <b>{item.productName || "Inspection"}</b>
        <small>{item.id}</small>
      </span>
      <span className={`status-word ${item.status}`}>{statusLabel(item.status)}</span>
    </button>
  );
}

function Metric({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div className={`metric metric-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export function HomeView({ role = "officer", onStart, saved, onHistory, onClearHistory }: { role?: UserRole; onStart: () => void; saved: Inspection[]; onHistory: () => void; onClearHistory?: () => void; }) {
  const passCount = saved.filter(i => i.status === 'pass').length;
  const reviewCount = saved.filter(i => i.status === 'review').length;
  const passRate = saved.length > 0 ? Math.round((passCount / saved.length) * 100) : 0;
  const isAdmin = role === "admin";

  return (
    <div className="page-enter">
      <div className="eyebrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>FIELD OPERATIONS / {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span>
        <span
          className="demo-auth-badge"
          style={{
            backgroundColor: isAdmin ? "#edf7f2" : "#f1f5f9",
            borderColor: isAdmin ? "#c4dfcf" : "#cbd5e1",
            color: isAdmin ? "var(--green)" : "var(--ink-soft)",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
          {isAdmin ? "Admin Role Active — Full System Access" : "Officer Role Active — Standard Field Scan"}
        </span>
      </div>
      <div className="home-heading">
        <div>
          <h1>Good morning, {isAdmin ? "administrator" : "officer"}.</h1>
          <p>Turn a package photograph into an evidence-backed inspection record.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {isAdmin ? (
            <button
              className="button secondary"
              style={{ color: "var(--red)", borderColor: "#fca5a5" }}
              onClick={onClearHistory}
              title="Admin action: Purge inspection archive"
            >
              <Trash2 size={15} /> Purge Archive
            </button>
          ) : (
            <button
              className="button secondary disabled"
              disabled
              style={{ opacity: 0.6, cursor: "not-allowed" }}
              title="🔒 Admin role required — Switch to Admin in top bar to purge inspection archive or manage rules"
            >
              <Lock size={13} /> Purge Archive (Admin Only)
            </button>
          )}
          <button className="button primary" onClick={onStart}><Camera size={16} /> Start inspection <ArrowUpRight size={16} /></button>
        </div>
      </div>
      <div className="signal-band">
        <div className="signal-icon"><ShieldCheck size={19} /></div>
        <div>
          <b>Inspection node is ready</b>
          <span>Vision extraction is configured at the API boundary. Deterministic ruleset <strong>LM-PC 2011 / v1.1</strong> will keep unverified legal text in review.</span>
        </div>
        <span className="signal-label">{isAdmin ? "ADMIN CONTROL" : "OPERATIONAL"}</span>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">WORKBENCH</span>
          <h2>Inspection pulse</h2>
        </div>
        <span className="muted">All time <ChevronRight size={14} /></span>
      </div>
      <div className="metric-grid">
        <Metric label="Inspections logged" value={String(saved.length)} note="Total records" accent="ink" />
        <Metric label="Compliant" value={`${passRate}%`} note={`${passCount} inspections`} accent="green" />
        <Metric label="Need review" value={String(reviewCount)} note="Manual attention" accent="amber" />
      </div>
      <div className="home-grid">
        <section className="quick-start">
          <div className="quick-copy">
            <span className="eyebrow">PRIMARY WORKFLOW</span>
            <h2>Scan a packaged commodity</h2>
            <p>Capture declarations, validate mandatory fields, and preserve the evidence trail in one pass.</p>
            <button className="text-button" onClick={onStart}>Open scan workspace <ArrowUpRight size={15} /></button>
          </div>
          <div className="abstract-pack">
            <div className="pack-top">FIELD SAMPLE</div>
            <b>500<small>g</small></b>
            <span>chickpeas</span>
            <i>HARVEST<br />GOLD</i>
          </div>
        </section>
        <section className="recent-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h3>Latest inspections</h3>
            </div>
            <button className="icon-button" aria-label="View inspection history" onClick={onHistory}><ArrowUpRight size={17} /></button>
          </div>
          {saved.slice(0, 3).map((item) => <HistoryRow key={item.id} item={item} onClick={() => {}} />)}
          {saved.length === 0 && (
            <div className="empty-row">
              <Clock3 size={18} />
              <span>Your saved inspections will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

