import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface AlertCardProps {
  type: string;
  severity: string;
  message: string;
  onResolve?: () => void;
  resolved?: boolean;
}

export function AlertCard({ type, severity, message, onResolve, resolved }: AlertCardProps) {
  const colors = useColors();

  const severityConfig: Record<string, { color: string; icon: keyof typeof Feather.glyphMap; bg: string }> = {
    Danger: { color: colors.destructive, icon: "alert-circle", bg: colors.destructive + "12" },
    Warning: { color: colors.warning, icon: "alert-triangle", bg: colors.warning + "15" },
    Info: { color: colors.primary, icon: "info", bg: colors.primary + "12" },
  };

  const config = severityConfig[severity] || severityConfig.Info;

  return (
    <View style={[styles.card, { backgroundColor: config.bg, borderRadius: colors.radius, opacity: resolved ? 0.5 : 1 }]}>
      <View style={styles.content}>
        <Feather name={config.icon} size={18} color={config.color} style={styles.icon} />
        <View style={styles.textContainer}>
          <Text style={[styles.type, { color: config.color }]}>{type}</Text>
          <Text style={[styles.message, { color: colors.foreground }]}>{message}</Text>
        </View>
      </View>
      {!resolved && onResolve && (
        <TouchableOpacity
          onPress={onResolve}
          style={[styles.resolveButton, { borderColor: config.color + "30" }]}
          activeOpacity={0.7}
        >
          <Feather name="check" size={14} color={config.color} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    marginBottom: 8,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
  },
  icon: {
    marginRight: 10,
    marginTop: 1,
  },
  textContainer: {
    flex: 1,
  },
  type: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  resolveButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
});
