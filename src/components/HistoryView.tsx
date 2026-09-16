"use client";

/**
 * DEMO-GRADE ROLE-GATED HISTORY VIEW
 * Destructive administrative operations (e.g. Purge Archive) are gated behind the 'admin' role.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock3, FileText, Filter, History, Lock, Search, Trash2, X } from "lucide-react";
import type { Inspection } from "@/domain/inspection";
import { statusLabel, formatDate } from "@/components/utils";

export type UserRole = "officer" | "admin";

interface HistoryViewProps {
  items: Inspection[];
  onOpen: (item: Inspection) => void;
  role: UserRole;
  onClearHistory?: () => void;
  isLoading?: boolean;
  onStartInspection?: () => void;
  filterRule?: string | null;
  filterDate?: string | null;
  onClearFilter?: () => void;
}

export function HistoryView({ items, onOpen: _onOpen, role, onClearHistory, isLoading = false, onStartInspection, filterRule, filterDate, onClearFilter }: HistoryViewProps) {
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    let result = items;
    if (filterRule) {
      result = result.filter((item) =>
        item.checks?.some((c) => c.ruleId === filterRule)
      );
    }
    if (filterDate) {
      result = result.filter((item) => {
        const d = new Date(item.createdAt);
        if (isNaN(d.getTime())) return filterDate === "Today";
        const itemDateKey = new Intl.DateTimeFormat("en-IN", { month: "short", day: "2-digit" }).format(d);
        return itemDateKey === filterDate;
      });
    }
    if (!query.trim()) return result;
    const q = query.toLowerCase().trim();
    return result.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        (item.productName && item.productName.toLowerCase().includes(q)) ||
        item.status.toLowerCase().includes(q)
    );
  }, [items, query, filterRule, filterDate]);

  return (
    <div className="page-enter">
      <div className="eyebrow">RECORDS / BACKEND ARCHIVE</div>
      <div className="page-heading">
        <div>
          <h1>Inspection history</h1>
          <p>Every saved result keeps its declarations, rules, and evidence together.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div className="search-field">
            <Search size={16} />
            <input
              placeholder="Search inspections"
              aria-label="Search inspections"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {role === "admin" ? (
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
              title="🔒 Admin role required — Switch to Admin in top bar to purge inspection archive"
            >
              <Lock size={13} /> Purge Archive (Admin Only)
            </button>
          )}
        </div>
      </div>
      {(filterRule || filterDate) && (
        <div className="signal-band" style={{ marginBottom: "24px", borderColor: "var(--amber-border)", background: "var(--amber-pale)" }}>
          <div className="signal-icon" style={{ background: "#fef3cd", color: "var(--amber)" }}><Filter size={17} /></div>
          <div style={{ flex: 1 }}>
            <b>Filtered view</b>
            <span>
              {filterRule && <>Showing inspections with rule violation: <strong>{filterRule}</strong></>}
              {filterDate && <>Showing inspections from: <strong>{filterDate}</strong></>}
            </span>
          </div>
          <button className="text-button" style={{ color: "var(--amber)" }} onClick={onClearFilter}>
            Clear filter <X size={14} />
          </button>
        </div>
      )}
      <section className="history-table">
        <div className="history-header">
          <span>Inspection</span>
          <span>Product</span>
          <span>Score</span>
          <span>Outcome</span>
          <span>Captured</span>
          <span />
        </div>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div className="history-row" key={`skeleton-${idx}`}>
              <span className="history-id">
                <div className="skeleton-box" style={{ width: "30px", height: "30px", borderRadius: "4px" }} />
                <div className="skeleton-box" style={{ width: "90px", height: "16px" }} />
              </span>
              <div className="skeleton-box" style={{ width: "140px", height: "16px" }} />
              <div className="skeleton-box" style={{ width: "50px", height: "16px" }} />
              <div className="skeleton-box" style={{ width: "70px", height: "16px" }} />
              <div className="skeleton-box" style={{ width: "80px", height: "16px" }} />
              <span />
            </div>
          ))
        ) : filteredItems.length ? (
          filteredItems.map((item) => (
            <Link href={`/inspection/${item.id}`} className="history-row" key={item.id}>
              <span className="history-id">
                <span className="history-icon">
                  <FileText size={16} />
                </span>
                <b>{item.id}</b>
              </span>
              <span>{item.productName || "Unnamed commodity"}</span>
              <span style={{ fontWeight: 600 }}>{item.score !== undefined ? `${item.score}/100` : "-"}</span>
              {item.extractionSource === "local_offline_ocr" ? (
                <span className="status-word review" style={{ backgroundColor: "#fff2df", color: "#995910", borderColor: "#fbd99d", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem" }}>
                  <Clock3 size={11} /> Provisional — awaiting network
                </span>
              ) : (
                <span className={`status-word ${item.status}`}>{statusLabel(item.status)}</span>
              )}
              <span>{formatDate(item.createdAt)}</span>
              <ChevronRight size={16} />
            </Link>
          ))
        ) : items.length === 0 ? (
          <div className="empty-state-box" style={{ margin: "24px 16px" }}>
            <div className="empty-state-icon">
              <History size={24} />
            </div>
            <h3>Inspection archive is empty</h3>
            <p>
              No package inspections have been recorded yet. Perform a scan and save the audit record to populate your Legal Metrology archive.
            </p>
            {onStartInspection && (
              <button className="button primary" onClick={onStartInspection} style={{ marginTop: "8px" }}>
                Start new inspection <ChevronRight size={15} />
              </button>
            )}
          </div>
        ) : (
          <div className="table-empty">
            <History size={22} />
            <b>No matching records found</b>
            <span>Try adjusting your search query &quot;{query}&quot;.</span>
          </div>
        )}
      </section>

      {/* Storage Infrastructure Footer */}
      <footer style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
        <span>Persistence Engine: <strong style={{ color: "var(--fg)" }}>SQLite</strong> (embedded via Prisma ORM)</span>
        <span><strong>{items.length}</strong> inspections stored</span>
      </footer>
    </div>
  );
}
