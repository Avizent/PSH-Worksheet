import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { setBaseUrl, setDefaultHeaders } from "@workspace/api-client-react";
import { getApiUrl } from "@/utils/getApiUrl";
import { setVpSessionToken } from "@/utils/vpSession";

SplashScreen.preventAutoHideAsync();

const apiUrl = getApiUrl();
setBaseUrl(apiUrl);

const queryClient = new QueryClient();

async function initVpSession(): Promise<void> {
  const vpApiKey = process.env.EXPO_PUBLIC_VP_API_KEY;
  if (!vpApiKey) return;
  try {
    const res = await fetch(`${apiUrl}/api/auth/vp-login`, {
      method: "POST",
      headers: { "x-api-key": vpApiKey, "content-type": "application/json" },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.sessionToken) {
      setDefaultHeaders({ "x-vp-session": data.sessionToken });
      setVpSessionToken(data.sessionToken);
    }
  } catch {}
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="board-view" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    initVpSession().finally(() => setSessionReady(true));
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && sessionReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, sessionReady]);

  if (!fontsLoaded && !fontError) return null;
  if (!sessionReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
