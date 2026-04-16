import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getApiUrl } from "@/utils/getApiUrl";
import { saveSessionToken, getSessionToken, clearSessionToken } from "@/lib/authSession";

interface AuthUser {
  email: string;
  name: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const apiUrl = getApiUrl();

  const checkSession = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        setUser(null);
        return;
      }
      const res = await fetch(`${apiUrl}/api/auth/me`, {
        headers: { "x-user-session": token },
      });
      if (res.ok) {
        const data = await res.json();
        setUser({ email: data.email, name: data.name });
      } else {
        await clearSessionToken();
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`${apiUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error ?? "Login failed" };
        }
        await saveSessionToken(data.token);
        setUser({ email: data.email, name: data.name });
        return { success: true };
      } catch {
        return { success: false, error: "Network error. Please try again." };
      }
    },
    [apiUrl],
  );

  const logout = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (token) {
        await fetch(`${apiUrl}/api/auth/logout`, {
          method: "POST",
          headers: { "x-user-session": token },
        });
      }
    } catch {}
    await clearSessionToken();
    setUser(null);
  }, [apiUrl]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
