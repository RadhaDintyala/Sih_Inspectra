"use client";

import Link from "next/link";
import { ShieldCheck, Shield, Info } from "lucide-react";

interface ForbiddenViewProps {
  onReturnDashboard?: () => void;
  message?: string;
}

export function ForbiddenView({ onReturnDashboard, message }: ForbiddenViewProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at center, rgba(16, 185, 129, 0.18) 0%, rgba(6, 20, 16, 0.96) 60%, #030a07 100%)",
        color: "#f8fafc",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        padding: "20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background Watermark Shield Pattern */}
      <svg
        viewBox="0 0 200 200"
        style={{
          position: "absolute",
          width: "600px",
          height: "600px",
          opacity: 0.03,
          pointerEvents: "none",
          stroke: "#10b981",
          fill: "none",
          strokeWidth: 1.5,
        }}
      >
        <path d="M100 20 L170 50 V110 C170 150 100 180 100 180 C100 180 30 150 30 110 V50 Z" />
        <path d="M85 100 L95 110 L120 85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Main Glassmorphism 403 Card */}
      <div
        className="page-enter"
        style={{
          width: "100%",
          maxWidth: "440px",
          background: "rgba(10, 22, 17, 0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(16, 185, 129, 0.3)",
          borderRadius: "16px",
          padding: "40px 32px 32px",
          boxShadow: "0 0 50px rgba(16, 185, 129, 0.15), inset 0 0 20px rgba(16, 185, 129, 0.04)",
          textAlign: "center",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Shield Emblem with Dotted Orbit Ring */}
        <div style={{ position: "relative", width: "90px", height: "90px", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "1.5px dashed rgba(16, 185, 129, 0.45)",
              animation: "spinSlow 20s linear infinite",
            }}
          />
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 20px rgba(16, 185, 129, 0.25)",
            }}
          >
            <ShieldCheck size={36} style={{ color: "#34d399", filter: "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))" }} />
          </div>
        </div>

        {/* Security Status Header */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "10.5px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "#10b981",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}
        >
          SECURITY STATUS: RESTRICTED
        </div>

        <Shield size={14} style={{ color: "rgba(16, 185, 129, 0.4)", margin: "0 auto 20px", display: "block" }} />

        {/* 403 Title */}
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 700,
            color: "#ffffff",
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          403 &mdash; Access denied
        </h1>

        {/* Description */}
        <p
          style={{
            color: "#94a3b8",
            fontSize: "14px",
            lineHeight: 1.5,
            margin: "0 0 28px",
          }}
        >
          {message || "You don't have permission to view this page."}
        </p>

        {/* Action Button */}
        {onReturnDashboard ? (
          <button
            onClick={onReturnDashboard}
            style={{
              width: "100%",
              backgroundColor: "#061510",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.3)",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "#0d261d";
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.3)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "#061510";
              e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.4)";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.3)";
            }}
          >
            Return to dashboard
          </button>
        ) : (
          <Link
            href="/"
            style={{
              display: "block",
              width: "100%",
              backgroundColor: "#061510",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "8px",
              textDecoration: "none",
              transition: "all 0.2s ease",
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.3)",
            }}
          >
            Return to dashboard
          </Link>
        )}

        {/* Footer Contact Notice */}
        <div
          style={{
            marginTop: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            fontSize: "11px",
            fontFamily: "monospace",
            color: "#34d399",
            opacity: 0.85,
          }}
        >
          <Info size={13} style={{ color: "#34d399", flexShrink: 0 }} />
          <span>If you believe this is an error, contact your administrator.</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes spinSlow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
