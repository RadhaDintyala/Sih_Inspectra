"use client";

/**
 * DEMO-GRADE DASHBOARD & COMPLIANCE MONITORING VIEW
 *
 * Provides executive and analytical oversight for Legal Metrology inspections:
 * - Aggregate inspection volumes and compliance ratios (Pass / Fail / Review)
 * - Frequency breakdown of top violated rules
 * - Time-series trend chart of inspection decisions over time
 * - Detailed product compliance audit log
 */

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Download, Lock, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import type { Inspection } from "@/domain/inspection";
import { RULES } from "@/domain/rules";
import type { UserRole } from "@/context/RoleContext";

interface DashboardViewProps {
  role?: UserRole;
  inspections: Inspection[];
  onSelectInspection: (inspection: Inspection) => void;
  isLoading?: boolean;
  onStartInspection?: () => void;
  onFilterByRule?: (ruleId: string) => void;
  onFilterByDate?: (dateKey: string) => void;
}

export function DashboardView({ role = "officer", inspections, onSelectInspection: _onSelectInspection, isLoading = false, onStartInspection, onFilterByRule, onFilterByDate }: DashboardViewProps) {
  const stats = useMemo(() => {
    const total = inspections.length;
    const pass = inspections.filter((i) => i.status === "pass").length;
    const fail = inspections.filter((i) => i.status === "fail").length;
    const review = inspections.filter((i) => i.status === "review").length;
    const invalid = inspections.filter((i) => i.status === "invalid_evidence" || i.status === "incomplete").length;
    const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

    // Rule violation frequency across all inspection records
    const ruleViolations: Record<string, { count: number; ruleId: string; field: string }> = {};
    for (const insp of inspections) {
      for (const check of insp.checks || []) {
        if (check.status === "fail" || check.status === "review") {
          if (!ruleViolations[check.ruleId]) {
            ruleViolations[check.ruleId] = { count: 0, ruleId: check.ruleId, field: check.field };
          }
          ruleViolations[check.ruleId].count += 1;
        }
      }
    }

    // Rule 19/20 physical weighing compliance (officer-entered)
    let weighingsDone = 0;
    let weighingsInTolerance = 0;
    let weighingsDeviation = 0;
    let awaitingWeighing = 0;
    // Rule 7(3) character-height calibration status
    let heightEvaluated = 0;
    let heightPending = 0;
    for (const insp of inspections) {
      const physical = insp.physicalMeasurements || [];
      const hasAny = physical.filter((m) => m.measuredValue != null && m.measuredValue !== "").length > 0;
      if (hasAny) {
        weighingsDone += 1;
        if (physical.some((m) => m.withinTolerance === false)) weighingsDeviation += 1;
        else weighingsInTolerance += 1;
      } else if ((insp.checks || []).some((c) => c.validationType === "physical_verification" && c.status === "not_evaluated")) {
        awaitingWeighing += 1;
      }
      const heightChecks = (insp.checks || []).filter((c) => c.validationType === "character_height");
      heightEvaluated += heightChecks.filter((c) => c.status !== "not_evaluated").length;
      heightPending += heightChecks.filter((c) => c.status === "not_evaluated").length;
    }

    const topViolations = Object.values(ruleViolations)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((item) => {
        const ruleDef = RULES.find((r) => r.id === item.ruleId);
        return {
          ...item,
          label: ruleDef?.label || item.field,
          reference: ruleDef?.reference || item.ruleId,
          severity: ruleDef?.severity || "major",
        };
      });

    // Timeline grouping by date
    const timelineMap = new Map<string, { date: string; dateKey: string; pass: number; fail: number; review: number; invalid: number; total: number }>();
    for (const insp of [...inspections].reverse()) {
      const d = new Date(insp.createdAt);
      const dateKey = isNaN(d.getTime())
        ? "Today"
        : new Intl.DateTimeFormat("en-IN", { month: "short", day: "2-digit" }).format(d);

      const existing = timelineMap.get(dateKey) || { date: dateKey, dateKey: insp.createdAt, pass: 0, fail: 0, review: 0, invalid: 0, total: 0 };
      if (insp.status === "pass") existing.pass += 1;
      else if (insp.status === "fail") existing.fail += 1;
      else if (insp.status === "invalid_evidence" || insp.status === "incomplete") (existing as { invalid: number }).invalid += 1;
      else existing.review += 1;
      existing.total += 1;
      timelineMap.set(dateKey, existing);
    }

    const timeline = Array.from(timelineMap.values()).slice(-7);
    const maxDayTotal = Math.max(...timeline.map((t) => t.total), 1);

    return {
      total,
      pass,
      fail,
      review,
      invalid,
      passRate,
      topViolations,
      timeline,
      maxDayTotal,
      weighingsDone,
      weighingsInTolerance,
      weighingsDeviation,
      awaitingWeighing,
      heightEvaluated,
      heightPending,
    };
  }, [inspections]);

  if (isLoading) {
    return (
      <div className="page-enter">
        <div className="eyebrow">MONITORING CONSOLE / COMPLIANCE ANALYTICS</div>
        <div className="page-heading">
          <div>
            <h1>Inspection Dashboard</h1>
            <p>Real-time monitoring of product compliance, Legal Metrology violations, and market risk trends.</p>
          </div>
          <div className="demo-auth-badge">
            <BarChart3 size={13} /> FETCHING NODE
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "45%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "30%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "60%", height: "12px" }} />
          </div>
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "50%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "35%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "65%", height: "12px" }} />
          </div>
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "55%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "25%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "50%", height: "12px" }} />
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="skeleton-card" style={{ minHeight: "220px" }}>
            <div className="skeleton-box" style={{ width: "40%", height: "18px" }} />
            <div className="skeleton-box" style={{ width: "70%", height: "12px" }} />
            <div className="skeleton-box" style={{ width: "100%", height: "110px", marginTop: "16px" }} />
          </div>
          <div className="skeleton-card" style={{ minHeight: "220px" }}>
            <div className="skeleton-box" style={{ width: "35%", height: "18px" }} />
            <div className="skeleton-box" style={{ width: "65%", height: "12px" }} />
            <div className="skeleton-box" style={{ width: "100%", height: "110px", marginTop: "16px" }} />
          </div>
        </div>

        <div className="recent-panel skeleton-card" style={{ marginTop: "16px" }}>
          <div className="skeleton-box" style={{ width: "30%", height: "18px" }} />
          <div className="skeleton-row" style={{ marginTop: "12px" }}><div className="skeleton-box" style={{ width: "100%", height: "20px" }} /></div>
          <div className="skeleton-row"><div className="skeleton-box" style={{ width: "100%", height: "20px" }} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div className="eyebrow">MONITORING CONSOLE / COMPLIANCE ANALYTICS</div>
      <div className="page-heading">
        <div>
          <h1>Inspection Dashboard</h1>
          <p>Real-time monitoring of product compliance, Legal Metrology violations, and market risk trends.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {role === "admin" ? (
            <button
              className="button secondary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={() => alert("Admin Action: Compliance dataset JSON exported.")}
            >
              <Download size={14} /> Export Dataset
            </button>
          ) : (
            <button
              className="button secondary disabled"
              disabled
              style={{ opacity: 0.6, cursor: "not-allowed", fontSize: "12px", padding: "6px 12px" }}
              title="🔒 Admin role required — Switch to Admin in top bar to export raw compliance dataset"
            >
              <Lock size={12} /> Export Dataset (Admin Only)
            </button>
          )}
          <div className="demo-auth-badge">
            <BarChart3 size={13} /> LIVE METRICS NODE
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="metric-grid">
        <div className="metric metric-ink">
          <span>Total Scans Evaluated</span>
          <strong>{stats.total}</strong>
          <small>100% engine verified</small>
        </div>
        <div className="metric metric-green">
          <span>Pass Rate (Compliant)</span>
          <strong>{stats.passRate}%</strong>
          <small>{stats.pass} compliant commodities</small>
        </div>
        <div className="metric metric-amber">
          <span>Non-Compliant / Review</span>
          <strong>{stats.fail + stats.review}</strong>
          <small>{stats.fail} failed · {stats.review} under review</small>
        </div>
        <div className="metric metric-ink">
          <span>Invalid Evidence</span>
          <strong>{stats.invalid}</strong>
          <small>no package detected · recapture required</small>
        </div>
        <div className="metric metric-green">
          <span>Rule 19/20 Weighing</span>
          <strong>{stats.weighingsDone} / {stats.total || 0}</strong>
          <small>{stats.weighingsInTolerance} in tolerance · {stats.weighingsDeviation} deviation · {stats.awaitingWeighing} awaiting</small>
        </div>
        <div className="metric metric-amber">
          <span>Rule 7(3) Height Checks</span>
          <strong>{stats.heightEvaluated} / {stats.heightEvaluated + stats.heightPending || 0}</strong>
          <small>{stats.heightPending} pending physical-scale calibration</small>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Top Violated Rules Breakdown */}
        <section className="chart-card">
          <div className="chart-header">
            <div>
              <h3>Most Common Rule Violations</h3>
              <p>Frequency of non-compliance flags under Legal Metrology Rules, 2011</p>
            </div>
            <ShieldAlert size={18} className="muted-icon" />
          </div>

          <div className="violation-list">
            {stats.topViolations.length > 0 ? (
              stats.topViolations.map((v) => {
                const percentage = Math.round((v.count / Math.max(stats.total, 1)) * 100);
                return (
                  <div key={v.ruleId} className="violation-item" onClick={() => onFilterByRule?.(v.ruleId)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onFilterByRule?.(v.ruleId)}>
                    <div className="violation-meta">
                      <span>
                        <b>{v.ruleId}</b> — {v.label}
                        <span className={`severity-badge ${v.severity}`}>{v.severity}</span>
                      </span>
                      <span>{v.count} flags ({percentage}%)</span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className={`progress-bar-fill ${v.severity === "critical" ? "fail" : "review"}`}
                        style={{ width: `${Math.min(100, Math.max(12, percentage * 2))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty-row">
                <ShieldCheck size={18} />
                <span>No violations recorded yet across scanned commodities.</span>
              </div>
            )}
          </div>
        </section>

        {/* Inspection Activity Timeline Chart */}
        <section className="chart-card">
          <div className="chart-header">
            <div>
              <h3>Inspection Trend</h3>
              <p>Daily volume breakdown of pass, review, and fail decisions</p>
            </div>
            <BarChart3 size={18} className="muted-icon" />
          </div>

          {stats.timeline.length > 0 ? (
            <div className="timeline-chart">
              {stats.timeline.map((day) => {
                const heightPct = Math.round((day.total / stats.maxDayTotal) * 100);
                const passPct = (day.pass / day.total) * 100;
                const reviewPct = (day.review / day.total) * 100;
                const failPct = (day.fail / day.total) * 100;

                return (
                  <div key={day.date} className="timeline-column" onClick={() => onFilterByDate?.(day.dateKey)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onFilterByDate?.(day.dateKey)}>
                    <span className="timeline-count">{day.total}</span>
                    <div className="timeline-bars" style={{ height: `${Math.max(25, heightPct)}%` }}>
                      {day.fail > 0 && <div className="timeline-bar-segment fail" style={{ height: `${failPct}%` }} title={`${day.fail} Fail`} />}
                      {day.review > 0 && <div className="timeline-bar-segment review" style={{ height: `${reviewPct}%` }} title={`${day.review} Review`} />}
                      {day.pass > 0 && <div className="timeline-bar-segment pass" style={{ height: `${passPct}%` }} title={`${day.pass} Pass`} />}
                    </div>
                    <span className="timeline-label">{day.date}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-row">
              <BarChart3 size={18} />
              <span>Inspection volume timeline will populate as scans are saved.</span>
            </div>
          )}
        </section>
      </div>

      {/* Monitored Products Table */}
      <section className="recent-panel" style={{ marginTop: "16px" }}>
        <div className="panel-title" style={{ marginBottom: "16px" }}>
          <div>
            <span className="eyebrow">MONITORED COMMODITIES</span>
            <h3>Product Compliance Audit Log</h3>
          </div>
          <span className="muted">Showing recent inspections</span>
        </div>

        <div className="history-table">
          <div className="history-header">
            <span>Inspection</span>
            <span>Commodity Name</span>
            <span>Score</span>
            <span>Status</span>
            <span>Scanned</span>
            <span />
          </div>
          {inspections.length ? (
            inspections.slice(0, 6).map((item) => (
              <Link href={`/inspection/${item.id}`} key={item.id} className="history-row">
                <span className="history-id">
                  <span className="history-icon">
                    {item.status === "pass" ? <CheckCircle2 size={16} /> : item.status === "fail" ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <b>{item.id}</b>
                </span>
                <span>{item.productName || "Unnamed commodity"}</span>
                <span style={{ fontWeight: 600 }}>{item.score !== undefined ? `${item.score}/100` : "-"}</span>
                {item.extractionSource === "local_offline_ocr" ? (
                  <span className="status-word review" style={{ backgroundColor: "#fff2df", color: "#995910", borderColor: "#fbd99d", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem" }}>
                    Provisional — awaiting network
                  </span>
                ) : (
                  <span className={`status-word ${item.status}`}>{item.status.toUpperCase()}</span>
                )}
                <span>{new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}</span>
                <ChevronRight size={16} />
              </Link>
            ))
          ) : (
            <div className="empty-state-box" style={{ margin: "24px 0" }}>
              <div className="empty-state-icon">
                <BarChart3 size={24} />
              </div>
              <h3>No inspection metrics recorded</h3>
              <p>
                Your monitoring console is waiting for inspection data. Execute a scan on a packaged commodity to populate real-time compliance metrics, violation statistics, and history timelines.
              </p>
              {onStartInspection && (
                <button className="button primary" onClick={onStartInspection} style={{ marginTop: "8px" }}>
                  Start your first inspection <ChevronRight size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Storage Infrastructure Footer */}
      <footer style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
        <span>Persistence Engine: <strong style={{ color: "var(--fg)" }}>SQLite</strong> (embedded via Prisma ORM)</span>
        <span><strong>{stats.total}</strong> inspections stored</span>
      </footer>
    </div>
  );
}
