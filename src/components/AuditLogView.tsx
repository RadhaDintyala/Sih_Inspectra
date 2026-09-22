"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Search, Filter, RefreshCw, Clock, User, FileText, AlertCircle, CheckCircle2, XCircle } from "lucide-react";

interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, any>;
  timestamp: string;
  user?: {
    id: string;
    name: string;
    username: string;
    role: string;
    badgeNumber?: string;
  } | null;
  organization?: {
    id: string;
    code: string;
    name: string;
  } | null;
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  async function fetchLogs() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit-logs");
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to fetch audit logs.");
      }
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesAction = filterAction === "ALL" || log.action === filterAction;
    const matchesQuery =
      !searchQuery.trim() ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entityId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.user?.username || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.user?.name || "").toLowerCase().includes(searchQuery.toLowerCase());

    return matchesAction && matchesQuery;
  });

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case "LOGIN":
      case "LOGOUT":
        return { bg: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", border: "#93c5fd" };
      case "INSPECTION_CREATED":
      case "ANALYSIS_COMPLETED":
        return { bg: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "#6ee7b7" };
      case "INSPECTION_SUBMITTED":
        return { bg: "rgba(245, 158, 11, 0.12)", color: "#f59e0b", border: "#fcd34d" };
      case "MANUAL_OVERRIDE":
        return { bg: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6", border: "#c4b5fd" };
      case "VERDICT_APPROVED":
        return { bg: "rgba(16, 185, 129, 0.18)", color: "#059669", border: "#34d399" };
      case "VERDICT_REJECTED":
        return { bg: "rgba(239, 68, 68, 0.18)", color: "#dc2626", border: "#fca5a5" };
      default:
        return { bg: "rgba(107, 114, 128, 0.12)", color: "#6b7280", border: "#d1d5db" };
    }
  };

  return (
    <div className="page-enter">
      <div className="eyebrow">ADMINISTRATIVE SECURITY CONTROL / AUDIT ACCESS</div>
      <div className="page-heading">
        <div>
          <h1>System Audit Log Console</h1>
          <p>Cryptographically verified, immutable record of all enforcement inspection events, user logins, overrides, and verdicts.</p>
        </div>
        <button className="button secondary" onClick={fetchLogs} disabled={isLoading} style={{ fontSize: "12px", gap: "6px" }}>
          <RefreshCw size={14} className={isLoading ? "spin-soft" : ""} /> Refresh Logs
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "240px" }}>
          <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            type="text"
            placeholder="Search by action, entity ID, username, or inspector name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", paddingLeft: "36px", height: "38px", fontSize: "13px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface-overlay)" }}
          />
        </div>

        <div style={{ display: "flex", gap: "6px", alignItems: "center", overflowX: "auto" }}>
          <Filter size={14} style={{ color: "var(--muted)", marginRight: "4px" }} />
          {["ALL", "LOGIN", "INSPECTION_CREATED", "INSPECTION_SUBMITTED", "MANUAL_OVERRIDE", "VERDICT_APPROVED", "VERDICT_REJECTED"].map((act) => (
            <button
              key={act}
              className={`button ${filterAction === act ? "primary" : "secondary"}`}
              style={{ fontSize: "11px", padding: "4px 10px", height: "32px", whiteSpace: "nowrap" }}
              onClick={() => setFilterAction(act)}
            >
              {act === "ALL" ? "All Events" : act.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="login-error-banner" style={{ margin: "16px 0" }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="recent-panel">
        <div className="panel-title" style={{ marginBottom: "12px" }}>
          <div>
            <span className="eyebrow">IMMUTABLE EVENT RECORDS</span>
            <h3>Audit Log Records</h3>
          </div>
          <span className="muted">Showing {filteredLogs.length} events</span>
        </div>

        <div className="history-table">
          <div className="history-header" style={{ gridTemplateColumns: "1.6fr 1.4fr 1.2fr 2fr 1fr" }}>
            <span>Timestamp</span>
            <span>Action Event</span>
            <span>User / Badge</span>
            <span>Entity ID & Target</span>
            <span>Details</span>
          </div>

          {isLoading ? (
            <div className="empty-state-box" style={{ padding: "40px" }}>
              <RefreshCw size={24} className="spin-soft" style={{ color: "var(--primary)" }} />
              <p style={{ marginTop: "12px", fontSize: "13px" }}>Loading security audit log entries...</p>
            </div>
          ) : filteredLogs.length > 0 ? (
            filteredLogs.map((log) => {
              const badgeStyle = getActionBadgeColor(log.action);
              return (
                <div
                  key={log.id}
                  className="history-row"
                  style={{ gridTemplateColumns: "1.6fr 1.4fr 1.2fr 2fr 1fr", cursor: "pointer" }}
                  onClick={() => setSelectedLog(log)}
                >
                  <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", color: "var(--fg)" }}>
                    <Clock size={13} style={{ color: "var(--muted)" }} />
                    {new Date(log.timestamp).toLocaleString("en-IN", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>

                  <span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "12px",
                        fontSize: "10.5px",
                        fontWeight: 700,
                        backgroundColor: badgeStyle.bg,
                        color: badgeStyle.color,
                        border: `1px solid ${badgeStyle.border}`,
                        display: "inline-block",
                      }}
                    >
                      {log.action}
                    </span>
                  </span>

                  <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <User size={13} style={{ color: "var(--muted)" }} />
                    {log.user ? (
                      <div>
                        <b style={{ display: "block", fontSize: "12px" }}>@{log.user.username}</b>
                        <small style={{ fontSize: "10px", color: "var(--muted)" }}>{log.user.role}</small>
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>System Node</span>
                    )}
                  </span>

                  <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--fg)" }}>
                    <b>{log.entityType}:</b> {log.entityId}
                  </span>

                  <button
                    className="button secondary"
                    style={{ fontSize: "11px", padding: "2px 8px", height: "26px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLog(log);
                    }}
                  >
                    <FileText size={12} /> Inspect
                  </button>
                </div>
              );
            })
          ) : (
            <div className="empty-state-box" style={{ padding: "40px" }}>
              <ShieldCheck size={28} style={{ color: "var(--muted)" }} />
              <h3>No audit logs match criteria</h3>
              <p>No audit log events found matching the selected action filter or search query.</p>
            </div>
          )}
        </div>
      </div>

      {/* Selected Log Inspector Modal */}
      {selectedLog && (
        <div className="modal-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="modal-card page-enter" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "550px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <span className="eyebrow">EVENT AUDIT RECORD</span>
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Audit Entry #{selectedLog.id.slice(0, 8)}</h3>
              </div>
              <button className="button secondary" onClick={() => setSelectedLog(null)} style={{ padding: "4px 8px" }}>
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gap: "10px", fontSize: "13px" }}>
              <div>
                <strong>Action Type:</strong> <span className="status-word pass" style={{ fontSize: "11px" }}>{selectedLog.action}</span>
              </div>
              <div>
                <strong>Timestamp:</strong> {new Date(selectedLog.timestamp).toString()}
              </div>
              <div>
                <strong>User Account:</strong> {selectedLog.user ? `${selectedLog.user.name} (@${selectedLog.user.username}) · Role: ${selectedLog.user.role}` : "System Automated Engine"}
              </div>
              <div>
                <strong>Target Entity:</strong> {selectedLog.entityType} ({selectedLog.entityId})
              </div>
              <div>
                <strong>Event Payload (JSON):</strong>
                <pre
                  style={{
                    backgroundColor: "#0d1117",
                    color: "#58a6ff",
                    padding: "12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    overflowX: "auto",
                    marginTop: "6px",
                    maxHeight: "220px",
                  }}
                >
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>

            <div style={{ marginTop: "20px", textAlign: "right" }}>
              <button className="button primary" onClick={() => setSelectedLog(null)}>
                Close Audit Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
