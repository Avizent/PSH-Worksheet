import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";

type AdminKey = "owners" | "categories" | "import" | "audit" | "reforecast";

const ITEMS: { key: AdminKey; label: string; icon: keyof typeof Feather.glyphMap; route: Href }[] = [
  { key: "owners", label: "Owners", icon: "users", route: "/owners" },
  { key: "categories", label: "Categories", icon: "tag", route: "/categories" },
  { key: "import", label: "Import", icon: "upload", route: "/import" },
  { key: "audit", label: "Audit Log", icon: "file-text", route: "/audit" },
  { key: "reforecast", label: "Reforecast", icon: "refresh-cw", route: "/reforecast" },
];

interface AdminSubnavProps {
  active: AdminKey;
}

export function AdminSubnav({ active }: AdminSubnavProps) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Feather name="settings" size={12} color={colors.mutedForeground} />
        <Text style={[styles.headerLabel, { color: colors.mutedForeground }]}>ADMIN</Text>
      </View>
      <View style={styles.tabs}>
        {ITEMS.map((it) => {
          const isActive = it.key === active;
          return (
            <TouchableOpacity
              key={it.key}
              onPress={() => router.push(it.route)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={it.label}
              accessibilityState={{ selected: isActive }}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? colors.primary + "15" : "transparent",
                  borderColor: isActive ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather name={it.icon} size={13} color={isActive ? colors.primary : colors.mutedForeground} />
              <Text style={{
                fontSize: 12,
                fontFamily: isActive ? "Inter_600SemiBold" : "Inter_500Medium",
                color: isActive ? colors.primary : colors.foreground,
              }}>{it.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  tabs: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
  },
});
