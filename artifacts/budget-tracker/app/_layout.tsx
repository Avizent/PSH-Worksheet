import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/contexts/ToastContext";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiUrl } from "@/utils/getApiUrl";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";

SplashScreen.preventAutoHideAsync();

const apiUrl = getApiUrl();
setBaseUrl(apiUrl);

const queryClient = new QueryClient();

/**
 * The VP API-key login used to run here, reading EXPO_PUBLIC_VP_API_KEY.
 *
 * Anything prefixed EXPO_PUBLIC_ is inlined into the bundle at build time, so
 * on the web build the key was sitting in shipped JavaScript for anyone who
 * opened devtools — and it authenticated the highest privilege tier in the
 * app. It has been removed rather than rotated: the signed-in user session now
 * covers every screen that needed it (board settings, share links, exports,
 * rollover, reforecast), and external board members go through share links,
 * which are per-recipient, expiring and revocable.
 *
 * The server still accepts x-vp-session for a genuine server-side caller
 * holding VP_API_KEY, which is not a public variable.
 */

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inLoginScreen = segments[0] === "login";
    if (!isAuthenticated && !inLoginScreen) {
      router.replace("/login");
    } else if (isAuthenticated && inLoginScreen) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, segments, router]);

  // Hold rendering until the stored session has been checked. Screens mount
  // their queries immediately, and /api is gated, so rendering the tab tree
  // first means every initial request races the session header and 401s.
  if (isLoading) return null;

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerBackTitle: "Back" }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="board-view" options={{ headerShown: false }} />
      </Stack>
    </AuthGate>
  );
}

function ThemedRoot() {
  const { isLoaded } = useTheme();
  if (!isLoaded) return null;
  return <RootLayoutNav />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            {/* AuthProvider sits above CurrencyProvider: the currency lens
                reads the exchange rate from the gated API, so it must be able
                to wait for the session to be established. */}
            <AuthProvider>
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <ToastProvider>
                    <CurrencyProvider>
                      <ThemedRoot />
                    </CurrencyProvider>
                  </ToastProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
