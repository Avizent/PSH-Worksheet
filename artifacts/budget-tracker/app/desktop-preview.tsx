import React, { useEffect } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useLayout } from "@/hooks/useLayout";
import { useColors } from "@/hooks/useColors";
import { DesktopSidebar } from "@/components/DesktopSidebar";

export default function DesktopPreviewScreen() {
  const { isAuthenticated, isLoading } = useAuth();
  const { mode } = useLayout();
  const colors = useColors();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <DesktopSidebar />
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Desktop preview</Text>
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            Open the app in a wide browser window to see the full desktop layout.
          </Text>
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            Current mode: {mode} · Platform: {Platform.OS}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row" },
  content: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center" },
  card: { width: "100%", maxWidth: 720, padding: 24, borderRadius: 16, borderWidth: 1 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 8 },
  text: { fontSize: 15, fontFamily: "Inter_400Regular", marginTop: 6 },
});