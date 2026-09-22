"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Inspectra Error Boundary]:", error);
  }, [error]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0b1329",
      color: "#f8fafc",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "2rem",
      textAlign: "center"
    }}>
      <div style={{
        backgroundColor: "rgba(30, 41, 59, 0.7)",
        border: "1px solid rgba(239, 68, 68, 0.3)",
        borderRadius: "1rem",
        padding: "3rem 2rem",
        maxWidth: "480px",
        width: "100%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
      }}>
        <h1 style={{ fontSize: "4rem", margin: 0, fontWeight: 800, color: "#f87171" }}>500</h1>
        <h2 style={{ fontSize: "1.5rem", marginTop: "0.5rem", marginBottom: "1rem", color: "#e2e8f0" }}>
          System Error Encountered
        </h2>
        <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "2rem", lineHeight: 1.5 }}>
          An unexpected server-side anomaly occurred while processing your inspection request. The issue has been logged.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              backgroundColor: "#ef4444",
              color: "#ffffff",
              fontWeight: 600,
              padding: "0.75rem 1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer"
            }}
          >
            Retry Action
          </button>
          <Link
            href="/"
            style={{
              display: "inline-block",
              backgroundColor: "#1e293b",
              color: "#e2e8f0",
              fontWeight: 600,
              padding: "0.75rem 1.25rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              border: "1px solid rgba(148, 163, 184, 0.2)"
            }}
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
