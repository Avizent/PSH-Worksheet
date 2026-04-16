import React, { useRef } from "react";
import { View, Text, StyleSheet, Animated, PanResponder, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface SwipeableAlertCardProps {
  type: string;
  severity: string;
  message: string;
  onResolve?: () => void;
  resolved?: boolean;
}

export function SwipeableAlertCard({ type, severity, message, onResolve, resolved }: SwipeableAlertCardProps) {
  const colors = useColors();
  const translateX = useRef(new Animated.Value(0)).current;

  const severityConfig: Record<string, { color: string; icon: keyof typeof Feather.glyphMap; bg: string }> = {
    critical: { color: colors.destructive, icon: "alert-circle", bg: colors.destructive + "12" },
    warning: { color: colors.warning, icon: "alert-triangle", bg: colors.warning + "15" },
    info: { color: colors.primary, icon: "info", bg: colors.primary + "12" },
  };

  const config = severityConfig[severity] || severityConfig.info;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return !resolved && Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -100 && onResolve) {
          Animated.timing(translateX, {
            toValue: -400,
            duration: 250,
            useNativeDriver: Platform.OS !== "web",
          }).start(() => {
            onResolve();
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: Platform.OS !== "web",
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.wrapper}>
      {!resolved && (
        <View style={[styles.resolveAction, { backgroundColor: colors.success }]}>
          <Feather name="check" size={16} color="#fff" />
          <Text style={styles.resolveText}>Resolve</Text>
        </View>
      )}
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.card, opacity: resolved ? 0.5 : 1 },
          !resolved ? { transform: [{ translateX }] } : undefined,
        ]}
        {...(!resolved ? panResponder.panHandlers : {})}
      >
        <View style={[styles.tint, { backgroundColor: config.bg }]} />
        <View style={styles.content}>
          <Feather name={config.icon} size={18} color={config.color} style={styles.icon} />
          <View style={styles.textContainer}>
            <Text style={[styles.type, { color: config.color }]}>{type}</Text>
            <Text style={[styles.message, { color: colors.foreground }]} numberOfLines={3}>{message}</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    marginBottom: 8,
    overflow: "hidden",
    borderRadius: 8,
  },
  resolveAction: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 72,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 2,
  },
  resolveText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    overflow: "hidden",
  },
  tint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
  },
  icon: {
    marginRight: 10,
    marginTop: 1,
    flexShrink: 0,
  },
  textContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
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
});
