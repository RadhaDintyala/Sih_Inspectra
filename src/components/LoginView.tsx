"use client";

import { useState } from "react";
import { Lock, ShieldCheck, User, KeyRound, AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import type { SessionUser } from "@/services/auth";

interface LoginViewProps {
  onLoginSuccess: (user: SessionUser) => void;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Please enter both username and password.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Authentication failed. Please verify your credentials.");
        return;
      }

      if (data.user) {
        onLoginSuccess(data.user);
      }
    } catch {
      setErrorMsg("Network error connecting to authentication service.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="login-portal-wrapper">
      <div className="login-portal-card page-enter">
        <div className="login-emblem-header">
          <div className="gov-emblem-icon">
            <ShieldCheck size={36} />
          </div>
          <div className="gov-title-group">
            <span className="gov-subtitle">GOVERNMENT OF INDIA · MINISTRY OF CONSUMER AFFAIRS</span>
            <h1 className="gov-main-title">Legal Metrology Division</h1>
            <span className="portal-badge">INSPECTRA COMPLIANCE PORTAL</span>
          </div>
        </div>

        <div className="login-form-container">
          <div className="login-instructions">
            <h2>Authorized Access Only</h2>
            <p>
              Sign in with your official enforcement officer or system administrator credentials to access inspection consoles.
            </p>
          </div>

          {errorMsg && (
            <div className="login-error-banner page-enter">
              <AlertTriangle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="login-username">
                <User size={14} /> Username
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="e.g. officer or admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">
                <KeyRound size={14} /> Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <button type="submit" className="button primary login-submit-btn" disabled={isLoading}>
              {isLoading ? (
                <span>Authenticating…</span>
              ) : (
                <>
                  <span>Sign In to Console</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="login-security-notice">
            <ShieldAlert size={14} />
            <span>
              All portal sessions are signed and cryptographically verified. Unauthorized access attempts are logged under the Legal Metrology Act, 2009.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
