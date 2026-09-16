"use client";

/**
 * Shareable inspection result page.
 * Fetches a single inspection by ID from the API and renders the same ResultView
 * used in the main SPA flow, enabling direct URL access to any saved inspection.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ScanLine } from "lucide-react";
import type { ComplianceCheck, Inspection } from "@/domain/inspection";
import { ResultView } from "@/components/ResultView";

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState<ComplianceCheck | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/scan/${id}`);
        if (!res.ok) {
          if (!cancelled) setError(`Inspection "${id}" not found.`);
          return;
        }
        const data = await res.json();
        if (!cancelled) setInspection(data.inspection);
      } catch {
        if (!cancelled) setError("Failed to load inspection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  const counts = useMemo(() => {
    const checks = inspection?.checks || [];
    return {
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
      review: checks.filter((c) => c.status === "review").length,
    };
  }, [inspection]);

  const chooseFinding = useCallback((check: ComplianceCheck) => {
    setSelectedCheck(check);
    document.querySelector(".evidence-stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const saveInspection = useCallback(() => {
    if (inspection) setReportOpen(true);
  }, [inspection]);

  if (loading) {
    return (
      <main className="app-shell">
        <div className="workspace" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div style={{ textAlign: "center" }}>
            <ScanLine size={32} className="spin-soft" style={{ marginBottom: 12 }} />
            <p>Loading inspection…</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !inspection) {
    return (
      <main className="app-shell">
        <div className="workspace" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <AlertTriangle size={40} style={{ color: "var(--amber)", marginBottom: 12 }} />
            <h2 style={{ marginBottom: 8 }}>Inspection not found</h2>
            <p style={{ color: "var(--muted)", marginBottom: 20 }}>{error || "The requested inspection could not be loaded."}</p>
            <Link href="/" className="button primary">
              <ArrowLeft size={15} /> Back to console
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <ScanLine size={18} />
          </span>
          <span>
            Inspectra<small>LEGAL METROLOGY</small>
          </span>
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <Link href="/" className="nav-item">
            <ArrowLeft size={17} /> Back to console
          </Link>
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> Local inspection node <small>v1.1 engine</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <Link href="/" className="mobile-menu" aria-label="Back to console">
            <ArrowLeft size={20} />
          </Link>
          <div className="breadcrumb">
            Inspection console <span style={{ margin: "0 6px" }}>/</span>{" "}
            <strong>{inspection.productName || inspection.id}</strong>
          </div>
          <div className="topbar-meta">
            <span className="live-indicator">
              <span className="status-dot" /> Shared view
            </span>
          </div>
        </header>

        <div className="content">
          <ResultView
            inspection={inspection}
            counts={counts}
            selectedCheck={selectedCheck}
            onSelect={chooseFinding}
            onReport={saveInspection}
            reportOpen={reportOpen}
            onCloseReport={() => setReportOpen(false)}
          />
        </div>
      </section>
    </main>
  );
}
