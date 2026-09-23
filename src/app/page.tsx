"use client";

/**
 * CREDENTIALED DUAL-PORTAL ARCHITECTURE
 *
 * Genuinely differentiated experiences for Officer and Admin portals:
 * - Officer Portal: Field inspection & image capture workflow (landing: scan)
 * - Admin Portal: Dashboard analytics & rules management (landing: dashboard)
 *
 * Authenticated via signed HttpOnly session cookies.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Camera,
  ChevronRight,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { AnalysisPhase, ComplianceCheck, Inspection, InspectionStatus } from "@/domain/inspection";
import { HomeView } from "@/components/HomeView";
import { ScanView } from "@/components/ScanView";
import { ResultView } from "@/components/ResultView";
import { HistoryView } from "@/components/HistoryView";
import { RulesView } from "@/components/RulesView";
import { DashboardView } from "@/components/DashboardView";
import { LoginView } from "@/components/LoginView";
import { useRole } from "@/context/RoleContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { compressAndDownscaleImage } from "@/services/image-compression";
import { startSyncEngine } from "@/services/sync-engine";
import { AuditLogView } from "@/components/AuditLogView";
import { ReviewerQueueView } from "@/components/ReviewerQueueView";
import { ForbiddenView } from "@/components/ForbiddenView";

type View = "home" | "dashboard" | "scan" | "result" | "history" | "rules" | "audit_logs" | "reviewer_queue";

function newInspection() {
  return {
    id: "DRAFT",
    createdAt: new Date().toISOString(),
    status: "processing" as InspectionStatus,
    images: [],
    declarations: [],
    checks: [],
    notes: [],
  } satisfies Inspection;
}

export default function Home() {
  const { user, role, isAuthenticated, isLoadingAuth, login, logout, isAdmin, isReviewer } = useRole();
  const [view, setView] = useState<View>("scan");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>("image");
  const [selectedCheck, setSelectedCheck] = useState<ComplianceCheck | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [fileName, setFileName] = useState("No image selected");
  const [activeFiles, setActiveFiles] = useState<File[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [savedInspections, setSavedInspections] = useState<Inspection[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [dashboardFilterRule, setDashboardFilterRule] = useState<string | null>(null);
  const [dashboardFilterDate, setDashboardFilterDate] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [isTimeout, setIsTimeout] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const isAnalyzingRef = useRef<boolean>(false);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const initialViewSetRef = useRef<boolean>(false);
  const currentInspectionIdRef = useRef<string | undefined>(inspection?.id);

  useEffect(() => {
    currentInspectionIdRef.current = inspection?.id;
  }, [inspection?.id]);

  // Clean up staged object URLs and abort in-flight requests only when unmounting
  useEffect(() => {
    return () => {
      analyzeAbortRef.current?.abort();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  // Set default role landing view once authenticated
  useEffect(() => {
    if (isAuthenticated && !initialViewSetRef.current) {
      initialViewSetRef.current = true;
      if (isAdmin) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView("dashboard");
      } else if (isReviewer) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView("reviewer_queue");
      } else {
        startInspection();
      }
    }
  }, [isAuthenticated, isAdmin, isReviewer]);

  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch("/api/scan");
      if (res.ok) {
        const data = await res.json();
        setSavedInspections(data.inspections || []);
      }
    } catch (e) {
      console.error("Failed to fetch history", e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchHistory();

      // Start background sync engine for offline pending_sync re-verification
      const stopSync = startSyncEngine({
        onRecordSynced: (updatedInspection) => {
          setSavedInspections((prev) =>
            prev.map((item) => (item.id === updatedInspection.id ? updatedInspection : item)),
          );
          if (currentInspectionIdRef.current === updatedInspection.id) {
            setInspection(updatedInspection);
          }
        },
      });

      return () => {
        stopSync();
      };
    }
  }, [isAuthenticated, fetchHistory]);

  const counts = useMemo(() => {
    const checks = inspection?.checks || [];
    return {
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
      review: checks.filter((c) => c.status === "review").length,
    };
  }, [inspection]);

  function startInspection() {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    setInspection(newInspection());
    setSelectedCheck(null);
    setReportOpen(false);
    setPhase("image");
    setErrorMsg(null);
    setIsTimeout(false);
    setElapsed(0);
    setActiveFiles([]);
    setFileName("No image selected");
    setView("scan");
  }

  async function selectFiles(files: File[], append = false) {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsTimeout(false);
    const baseInspection = inspection || newInspection();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    const originalTotalBytes = files.reduce((acc, f) => acc + f.size, 0);

    const compressedFiles = await Promise.all(
      files.map((file) => compressAndDownscaleImage(file, file.name, 1600, 0.85)),
    );

    const compressedTotalBytes = compressedFiles.reduce((acc, f) => acc + f.size, 0);
    const reductionPct = originalTotalBytes > 0 ? Math.round((1 - compressedTotalBytes / originalTotalBytes) * 100) : 0;

    console.log(
      `[ClientUpload] Prepared ${files.length} file(s): Original total ${(originalTotalBytes / 1024).toFixed(1)} KB -> Compressed total ${(compressedTotalBytes / 1024).toFixed(1)} KB [-${reductionPct}%]`,
    );

    const nextFiles = append ? [...activeFiles, ...compressedFiles] : compressedFiles;
    setFileName(nextFiles.length === 1 ? nextFiles[0].name : `${nextFiles.length} package images`);
    setActiveFiles(nextFiles);

    const newUrls = nextFiles.map((file, i) => ({
      id: `pending-image-${i}`,
      uri: URL.createObjectURL(file),
      side: (i === 0 ? "front" : "unknown") as "front" | "unknown",
      width: 1600,
      height: 1200,
    }));
    objectUrlsRef.current = newUrls.map((img) => img.uri);
    setInspection({ ...baseInspection, images: newUrls });
  }

  function updateActiveFiles(nextFiles: File[]) {
    const baseInspection = inspection || newInspection();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    setFileName(
      nextFiles.length === 0
        ? "No image selected"
        : nextFiles.length === 1
        ? nextFiles[0].name
        : `${nextFiles.length} package images`
    );
    setActiveFiles(nextFiles);

    const newUrls = nextFiles.map((file, i) => ({
      id: `pending-image-${i}`,
      uri: URL.createObjectURL(file),
      side: (i === 0 ? "front" : "unknown") as "front" | "unknown",
      width: 1600,
      height: 1200,
    }));
    objectUrlsRef.current = newUrls.map((img) => img.uri);
    setInspection({ ...baseInspection, images: newUrls });
  }

  async function analyze() {
    if (isAnalyzingRef.current) {
      console.warn("[ScanAnalyze] Analysis already in progress. Ignoring duplicate trigger.");
      return;
    }

    if (!activeFiles.length) {
      setErrorMsg("Select a package image or capture one with the camera before analyzing.");
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setIsTimeout(false);
    setElapsed(0);
    // Immediately activate pipeline step 2 (Regional Detection & OCR) for clear visual feedback
    setPhase("text");

    const baseInspection = inspection || newInspection();
    const overallStartTime = Date.now();
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - overallStartTime) / 1000));
    }, 1000);

    const payloadBytes = activeFiles.reduce((acc, f) => acc + f.size, 0);
    const payloadKb = (payloadBytes / 1024).toFixed(1);
    console.log(`[ScanAnalyze] Dispatching ${activeFiles.length} file(s), payload size: ${payloadKb} KB`);

    const maxAttempts = 2;
    let attempt = 0;
    let success = false;

    try {
      while (attempt < maxAttempts && !success) {
        attempt++;
        const attemptStartTime = Date.now();
        try {
          const controller = new AbortController();
          analyzeAbortRef.current = controller;
          const clientTimeout = setTimeout(() => controller.abort(), 60_000);

          const formData = new FormData();
          activeFiles.forEach((f, i) => {
            formData.append("image", f);
            formData.append("side", i === 0 ? "front" : i === 1 ? "back" : "side");
          });

          console.log(`[ScanAnalyze] Sending POST /api/scan (Attempt ${attempt}/${maxAttempts})...`);
          const res = await fetch("/api/scan", { method: "POST", body: formData, signal: controller.signal });
          clearTimeout(clientTimeout);

          const latencyMs = Date.now() - attemptStartTime;
          console.log(`[ScanAnalyze] POST /api/scan finished in ${latencyMs}ms (Status ${res.status}).`);

          let data: Record<string, unknown>;
          try {
            data = await res.json();
          } catch {
            throw new Error(`Server returned invalid response (HTTP ${res.status}). Please try again.`);
          }

          if (res.status === 202) {
            // Async worker path: poll the status URL until the pipeline finishes.
            const statusUrl = (data as { statusUrl?: string }).statusUrl;
            if (!statusUrl) throw new Error("Queue accepted the inspection but returned no status URL.");
            const queuedInsp = (data as { inspection?: Inspection }).inspection;
            if (queuedInsp) {
              setInspection({
                ...queuedInsp,
                // Preserve staged image previews so the viewport doesn't go blank while queued!
                images: queuedInsp.images?.length ? queuedInsp.images : (baseInspection.images || []),
              });
            }
            setPhase("text");
            const deadline = Date.now() + 180_000;
            let missingCount = 0;
            for (;;) {
              if (Date.now() > deadline) throw new Error("Analysis timed out after 180 seconds. The worker may still be processing — check history.");
              await new Promise((r) => setTimeout(r, 2000));
              let poll: Response;
              try {
                poll = await fetch(statusUrl, { signal: controller.signal });
              } catch (e) {
                if ((e as DOMException)?.name === "AbortError") throw e;
                continue;
              }
              if (poll.status === 404) {
                // Row not visible yet (or a stale ID): keep waiting briefly,
                // then tell the officer exactly what is wrong.
                missingCount++;
                if (missingCount >= 15) {
                  throw new Error("Analysis worker has not picked up the inspection. Start one with `npm run worker`, then retry.");
                }
                continue;
              }
              if (!poll.ok) continue;
              missingCount = 0;
              const payload = (await poll.json()) as {
                inspection?: Inspection;
                job?: { status?: string; error?: string } | null;
              };
              const jobStatus = payload.job?.status;
              const insp = payload.inspection;
              if (insp?.processingStatus) {
                const ps = insp.processingStatus;
                if (ps === "DETECTING_PACKAGE" || ps === "DETECTING_DECLARATIONS" || ps === "DETECTING") setPhase("text");
                else if (ps === "OCR_PROCESSING" || ps === "EXTRACTING_FIELDS" || ps === "EXTRACTING") setPhase("declarations");
                else if (ps === "VALIDATING" || ps === "COMPLIANCE_ANALYSIS") setPhase("rules");
              } else if (jobStatus === "PROCESSING") {
                setPhase("text");
              }
              const terminal = insp && insp.processingStatus !== undefined &&
                !["UPLOADING", "QUEUED", "PROCESSING", "DETECTING_PACKAGE", "DETECTING_DECLARATIONS", "OCR_PROCESSING", "EXTRACTING_FIELDS", "VALIDATING", "COMPLIANCE_ANALYSIS", "DETECTING", "EXTRACTING"].includes(insp.processingStatus) &&
                insp.status !== "processing";
              if (jobStatus === "FAILED" && (!insp || insp.status === "processing")) {
                throw new Error(payload.job?.error || "Analysis worker failed. Please retry.");
              }
              if (insp && (terminal || jobStatus === "COMPLETED")) {
                setInspection(insp);
                setPhase("complete");
                setView("result");
                fetchHistory();
                success = true;
                break;
              }
            }
            break;
          }

          if (!res.ok) {
            const isTimeoutError =
              (data as { status?: string; error?: string }).status === "timeout" ||
              (data as { error?: string }).error === "EXTRACTION_TIMEOUT";
            if (isTimeoutError) {
              throw new Error("EXTRACTION_TIMEOUT: analysis timed out after 30 seconds.");
            }
            throw new Error(((data as { message?: string }).message) || ((data as { error?: string }).error) || "Analysis failed");
          }

          if (!(data as { inspection?: unknown }).inspection) {
            throw new Error("Analysis completed but returned no inspection data. Please try again.");
          }

          setInspection((data as { inspection: Inspection }).inspection);
          setPhase("complete");
          setView("result");
          fetchHistory();
          success = true;
          break;
        } catch (err) {
          const latencyMs = Date.now() - attemptStartTime;
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          const isTimeoutErr = isAbort || (err instanceof Error && (err.message.includes("EXTRACTION_TIMEOUT") || err.message.includes("timed out")));

          console.warn(`[ScanAnalyze] Attempt ${attempt}/${maxAttempts} failed after ${latencyMs}ms:`, err instanceof Error ? err.message : String(err));

          if (attempt < maxAttempts && isTimeoutErr) {
            console.warn("[ScanAnalyze] Automatic retry triggered. Waiting 1500ms backoff...");
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }

          setPhase("image");
          if (isTimeoutErr) {
            setIsTimeout(true);
            setErrorMsg("Analysis timed out. Click 'Retry analysis' below to try again.");
          } else {
            setErrorMsg(err instanceof Error ? err.message : String(err));
          }
        } finally {
          analyzeAbortRef.current = null;
        }
      }
    } finally {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    }
  }

  function retryAnalysis() {
    setIsTimeout(false);
    setErrorMsg(null);
    setElapsed(0);
    analyze();
  }

  function chooseFinding(check: ComplianceCheck) {
    setSelectedCheck(check);
    document.querySelector(".evidence-stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function saveInspection() {
    if (inspection) setReportOpen(true);
  }

  async function purgeArchive() {
    if (role !== "admin") return;
    if (!confirm("Admin confirmation: Purge all local inspection archive records?")) return;
    try {
      const res = await fetch("/api/inspections", { method: "DELETE" });
      if (res.ok) {
        setSavedInspections([]);
      } else {
        const data = await res.json();
        alert(`Action rejected: ${data.error || "403 Forbidden"}`);
      }
    } catch (e) {
      console.error("Purge error", e);
    }
  }

  // 1. Loading Authentication State
  if (isLoadingAuth) {
    return (
      <main className="login-portal-wrapper">
        <div style={{ textAlign: "center", color: "white" }}>
          <ScanLine size={42} className="spin-soft" style={{ marginBottom: "16px", color: "#4ade80" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Inspectra Enforcement System</h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", marginTop: "6px" }}>Authenticating secure console session…</p>
        </div>
      </main>
    );
  }

  // 2. Unauthenticated Login Gate
  if (!isAuthenticated || !user) {
    return (
      <LoginView
        onLoginSuccess={(loggedInUser) => {
          login(loggedInUser);
          if (loggedInUser.role === "admin") {
            setView("dashboard");
          } else if (loggedInUser.role === "reviewer") {
            setView("reviewer_queue");
          } else {
            startInspection();
          }
        }}
      />
    );
  }

  const navCls = (v: View) => (view === v ? "nav-item active" : "nav-item");
  const inspectNav = view === "scan" || view === "result" ? "nav-item active" : "nav-item";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <ScanLine size={18} />
          </span>
          <div>
            <span style={{ display: "block", fontWeight: 700, fontSize: "14px", lineHeight: 1.2 }}>
              {isAdmin ? "Inspectra Admin" : isReviewer ? "Inspectra Reviewer" : "Inspectra Officer"}
            </span>
            <small style={{ fontSize: "8.5px", color: "var(--ink-muted)", letterSpacing: "0.08em" }}>
              {isAdmin ? "CONTROL CENTER" : isReviewer ? "REVIEW CONSOLE" : "FIELD CONSOLE"}
            </small>
          </div>
        </div>

        <div style={{ padding: "0 12px 8px" }}>
          <span className={`portal-indicator-banner ${role}`}>
            {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
            {isAdmin ? "Admin Console" : isReviewer ? "Reviewer Console" : "Officer Portal"}
          </span>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {isAdmin ? (
            <>
              <button className={navCls("dashboard")} onClick={() => { fetchHistory(); setView("dashboard"); }}>
                <LayoutDashboard size={17} /> Analytics Dashboard
              </button>
              <button className={navCls("audit_logs")} onClick={() => setView("audit_logs")}>
                <ClipboardCheck size={17} /> Audit Logs Access
              </button>
              <button className={navCls("rules")} onClick={() => setView("rules")}>
                <ShieldCheck size={17} /> Rules Administration
              </button>
              <button className={navCls("history")} onClick={() => { fetchHistory(); setView("history"); }}>
                <History size={17} /> System Archive <span className="nav-count">{savedInspections.length}</span>
              </button>
              <button className={inspectNav} onClick={() => (inspection ? setView(inspection.status === "processing" ? "scan" : "result") : startInspection())}>
                <Camera size={17} /> Field Scanner
              </button>
            </>
          ) : isReviewer ? (
            <>
              <button className={navCls("reviewer_queue")} onClick={() => { fetchHistory(); setView("reviewer_queue"); }}>
                <ClipboardCheck size={17} /> Assigned Queue
              </button>
              <button className={navCls("history")} onClick={() => { fetchHistory(); setView("history"); }}>
                <History size={17} /> Inspection Archive <span className="nav-count">{savedInspections.length}</span>
              </button>
              <button className={navCls("rules")} onClick={() => setView("rules")}>
                <ShieldCheck size={17} /> Rules Reference
              </button>
            </>
          ) : (
            <>
              <button className={inspectNav} onClick={() => (inspection ? setView(inspection.status === "processing" ? "scan" : "result") : startInspection())}>
                <Camera size={17} /> Scan & Inspect
              </button>
              <button className={navCls("history")} onClick={() => { fetchHistory(); setView("history"); }}>
                <History size={17} /> Inspection History <span className="nav-count">{savedInspections.length}</span>
              </button>
              <button className={navCls("rules")} onClick={() => setView("rules")}>
                <ShieldCheck size={17} /> Rules Reference
              </button>
              <button className={navCls("home")} onClick={() => setView("home")}>
                <ClipboardCheck size={17} /> Overview
              </button>
            </>
          )}
        </nav>

        {/* Authenticated User Profile & Logout */}
        <div className="sidebar-user-footer">
          <div className="user-profile-card">
            <div className={`user-avatar-badge ${role}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="user-info-text">
              <span className="user-display-name" title={user.name}>{user.name}</span>
              <span className="user-role-label">@{user.username} · {role.toUpperCase()}</span>
            </div>
          </div>
          <button className="logout-action-btn" onClick={logout} title="End active session and return to login">
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            {isAdmin ? "Admin Control Center" : isReviewer ? "Reviewer Verification Console" : "Officer Enforcement Console"} <ChevronRight size={14} />{" "}
            <strong>
              {view === "home"
                ? "Overview"
                : view === "dashboard"
                ? "Analytics Dashboard"
                : view === "audit_logs"
                ? "Audit Logs Access"
                : view === "reviewer_queue"
                ? "Assigned Queue"
                : view === "scan"
                ? "Package Scanner"
                : view === "result"
                ? "Compliance Result"
                : view === "history"
                ? "Inspection Archive"
                : "Rules Reference"}
            </strong>
          </div>
          <div className="topbar-meta">
            <span className="live-indicator">
              <span className="status-dot" /> Session Active
            </span>
            <span className={`role-badge ${role}`}>
              {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
              {isAdmin ? "Administrator" : isReviewer ? "Reviewer" : "Enforcement Officer"}
            </span>
          </div>
        </header>

        <div className="content">
          <ErrorBoundary>
            {view === "home" && <HomeView role={role} onStart={startInspection} saved={savedInspections} onHistory={() => setView("history")} onClearHistory={purgeArchive} />}
            {view === "dashboard" && (
              <DashboardView
                role={role}
                inspections={savedInspections}
                isLoading={isLoadingHistory}
                onStartInspection={startInspection}
                onFilterByRule={(ruleId) => {
                  setDashboardFilterRule(ruleId);
                  setDashboardFilterDate(null);
                  setView("history");
                }}
                onFilterByDate={(dateKey) => {
                  setDashboardFilterDate(dateKey);
                  setDashboardFilterRule(null);
                  setView("history");
                }}
                onSelectInspection={(item) => {
                  setInspection(item);
                  setView("result");
                }}
              />
            )}
            {view === "audit_logs" && (
              isAdmin ? <AuditLogView /> : <ForbiddenView message="You don't have permission to access administrator security audit logs." onReturnDashboard={() => setView("scan")} />
            )}
            {view === "reviewer_queue" && (
              (isReviewer || isAdmin) ? (
                <ReviewerQueueView
                  inspections={savedInspections}
                  isLoading={isLoadingHistory}
                  onSelectInspection={(item) => {
                    setInspection(item);
                    setView("result");
                  }}
                />
              ) : (
                <ForbiddenView message="You don't have permission to view the reviewer queue." onReturnDashboard={() => setView("scan")} />
              )
            )}
            {view === "scan" && (
              <ScanView
                role={role}
                inspection={inspection}
                phase={phase}
                fileName={fileName}
                onUpload={() => fileInput.current?.click()}
                onFiles={selectFiles}
                onAnalyze={analyze}
                inputRef={fileInput}
                errorMsg={errorMsg}
                onDismissError={() => setErrorMsg(null)}
                elapsed={elapsed}
                isTimeout={isTimeout}
                onRetry={retryAnalysis}
                activeFiles={activeFiles}
                onUpdateFiles={updateActiveFiles}
                isAnalyzing={isAnalyzing}
              />
            )}
            {view === "result" && inspection && (
              <ResultView
                role={role}
                inspection={inspection}
                counts={counts}
                selectedCheck={selectedCheck}
                onSelect={chooseFinding}
                onReport={saveInspection}
                reportOpen={reportOpen}
                onCloseReport={() => setReportOpen(false)}
                onInspectionUpdated={(updated) => {
                  setInspection(updated);
                  fetchHistory();
                }}
              />
            )}
            {view === "result" && !inspection && (
              <div className="page-enter" style={{ padding: "40px 20px", textAlign: "center" }}>
                <div className="eyebrow">NO INSPECTION DATA</div>
                <h2 style={{ marginTop: "12px", fontSize: "18px", fontWeight: 700 }}>Inspection result unavailable</h2>
                <p style={{ marginTop: "8px", color: "var(--ink-soft)", fontSize: "13px" }}>
                  The analysis did not return inspection data. Please go back and try again.
                </p>
                <button className="button primary" style={{ marginTop: "16px" }} onClick={() => { setView("scan"); setPhase("image"); }}>
                  Back to scan
                </button>
              </div>
            )}
            {view === "history" && (
              <HistoryView
                items={savedInspections}
                isLoading={isLoadingHistory}
                onStartInspection={startInspection}
                filterRule={dashboardFilterRule}
                filterDate={dashboardFilterDate}
                onClearFilter={() => { setDashboardFilterRule(null); setDashboardFilterDate(null); }}
                onOpen={(item) => {
                  setInspection(item);
                  setView("result");
                }}
                role={isAdmin ? "admin" : "officer"}
                onClearHistory={purgeArchive}
              />
            )}
            {view === "rules" && <RulesView role={isAdmin ? "admin" : "officer"} onSwitchRole={() => {}} />}
          </ErrorBoundary>
        </div>
      </section>
    </main>
  );
}
