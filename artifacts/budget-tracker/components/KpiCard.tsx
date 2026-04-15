import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: keyof typeof Feather.glyphMap;
  color?: string;
  trend?: "up" | "down" | "neutral";
}

export function KpiCard({ title, value, subtitle, icon, color, trend }: KpiCardProps) {
  const colors = useColors();
  const { mode } = useLayout();
  const iconColor = color || colors.primary;
  const isDesktop = mode === "desktop";

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: colors.card,
        borderRadius: colors.radius,
        borderColor: colors.border,
        minWidth: isDesktop ? 220 : undefined,
        flex: isDesktop ? 1 : undefined,
      },
    ]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: iconColor + "15" }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        {trend && trend !== "neutral" && (
          <Feather
            name={trend === "up" ? "trending-up" : "trending-down"}
            size={14}
            color={trend === "up" ? colors.success : colors.destructive}
          />
        )}
      </View>
      <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.title, { color: colors.mutedForeground }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
      web: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
    }),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  title: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
});
