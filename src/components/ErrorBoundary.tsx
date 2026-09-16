"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-enter" style={{ padding: "40px 20px", textAlign: "center" }}>
          <div className="eyebrow">APPLICATION ERROR</div>
          <div style={{ marginTop: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: "50%", background: "#fef2f2", color: "#dc2626" }}>
            <AlertTriangle size={28} />
          </div>
          <h2 style={{ marginTop: "16px", fontSize: "20px", fontWeight: 700, color: "var(--ink)" }}>
            {this.props.fallbackLabel || "Something went wrong"}
          </h2>
          <p style={{ marginTop: "8px", color: "var(--ink-soft)", fontSize: "13px", maxWidth: 420, marginInline: "auto" }}>
            An unexpected error interrupted the inspection flow. Your uploaded images are still available.
          </p>
          <pre style={{ marginTop: "16px", padding: "12px 16px", background: "#f8fafa", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "11px", color: "var(--ink-soft)", maxWidth: 500, marginInline: "auto", overflow: "auto", textAlign: "left", whiteSpace: "pre-wrap" }}>
            {this.state.error?.message || "Unknown error"}
          </pre>
          <button
            className="button primary"
            style={{ marginTop: "20px" }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            <RefreshCw size={15} /> Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
