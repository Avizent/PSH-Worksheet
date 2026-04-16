import React from "react";
import { TouchableOpacity, Platform, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface WebRefreshButtonProps {
  onRefresh: () => void;
  refreshing: boolean;
}

export function WebRefreshButton({ onRefresh, refreshing }: WebRefreshButtonProps) {
  const colors = useColors();

  if (Platform.OS !== "web") return null;

  return (
    <TouchableOpacity
      onPress={onRefresh}
      disabled={refreshing}
      style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.7}
    >
      {refreshing ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name="refresh-cw" size={16} color={colors.primary} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    top: 72,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
});
