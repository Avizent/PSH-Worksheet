import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getApiUrl } from "@/utils/getApiUrl";
import { saveSessionToken, getSessionToken, clearSessionToken } from "@/lib/authSession";
import { setDefaultHeaders } from "@workspace/api-client-react";

/**
 * The generated API hooks share one default-header bag. Without this the
 * signed-in user's session never reaches the server on those calls, so every
 * auth-gated route (board settings, share links, exports, rollover,
 * reforecast) returns 401 even though the user is logged in.
 */
function applySessionHeader(token: string | null): void {
  // setDefaultHeaders merges, so clear by overwriting with an empty
  // value (falsy server-side) rather than passing an empty object.
  setDefaultHeaders({ "x-user-session": token ?? "" });
}

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
        applySessionHeader(null);
        setUser(null);
        return;
      }
      const res = await fetch(`${apiUrl}/api/auth/me`, {
        headers: { "x-user-session": token },
      });
      if (res.ok) {
        const data = await res.json();
        applySessionHeader(token);
        setUser({ email: data.email, name: data.name });
      } else {
        await clearSessionToken();
        applySessionHeader(null);
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
        applySessionHeader(data.token);
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
    applySessionHeader(null);
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
