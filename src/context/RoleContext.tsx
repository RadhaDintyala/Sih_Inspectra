"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { SessionUser, UserRole } from "@/services/auth";

export type { SessionUser, UserRole };

export interface RoleContextType {
  user: SessionUser | null;
  role: UserRole;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  login: (user: SessionUser) => void;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isOfficer: boolean;
  isReviewer: boolean;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      setIsLoadingAuth(true);
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
          return;
        }
      }
      setUser(null);
    } catch {
      setUser(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchSession());
  }, [fetchSession]);

  const login = useCallback((newUser: SessionUser) => {
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.warn("Logout request failed:", e);
    } finally {
      setUser(null);
    }
  }, []);

  const role: UserRole = user?.role || "officer";

  const userRoleStr = (user?.role || "").toLowerCase();
  const value: RoleContextType = {
    user,
    role,
    isAuthenticated: Boolean(user),
    isLoadingAuth,
    login,
    logout,
    isAdmin: userRoleStr === "admin",
    isOfficer: userRoleStr === "officer" || userRoleStr === "enforcement_officer",
    isReviewer: userRoleStr === "reviewer",
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextType {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return ctx;
}
