import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useColors } from "@/hooks/useColors";

interface NavItem {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "bar-chart-2", route: "/" },
  { key: "budget", label: "Budget Lines", icon: "list", route: "/budget" },
  { key: "alerts", label: "Alerts", icon: "bell", route: "/alerts" },
  { key: "events", label: "Events", icon: "calendar", route: "/events" },
];

interface DesktopSidebarProps {
  alertCount?: number;
}

export function DesktopSidebar({ alertCount = 0 }: DesktopSidebarProps) {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();

  const getActiveKey = (): string => {
    if (pathname === "/" || pathname === "/index") return "dashboard";
    const segment = pathname.replace(/^\//, "").split("/")[0];
    return segment || "dashboard";
  };

  const activeKey = getActiveKey();

  return (
    <View style={[styles.sidebar, { backgroundColor: colors.card, borderRightColor: colors.border }]}>
      <View style={styles.logo}>
        <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
          <Feather name="trending-up" size={20} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.logoText, { color: colors.foreground }]}>Hubert</Text>
        <Text style={[styles.logoSubtext, { color: colors.mutedForeground }]}>Marketing Budget</Text>
      </View>

      <View style={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => router.push(item.route as any)}
              style={[
                styles.navItem,
                isActive && { backgroundColor: colors.primary + "10" },
              ]}
              activeOpacity={0.7}
            >
              <Feather
                name={item.icon}
                size={18}
                color={isActive ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.navLabel,
                  { color: isActive ? colors.primary : colors.mutedForeground },
                  isActive && { fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {item.label}
              </Text>
              {item.key === "alerts" && alertCount > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
                  <Text style={styles.badgeText}>{alertCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={[styles.userAvatar, { backgroundColor: colors.primary + "15" }]}>
          <Text style={[styles.userInitial, { color: colors.primary }]}>VP</Text>
        </View>
        <View>
          <Text style={[styles.userName, { color: colors.foreground }]}>VP Marketing</Text>
          <Text style={[styles.userRole, { color: colors.mutedForeground }]}>Editor</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 240,
    borderRightWidth: 1,
    paddingTop: 24,
    justifyContent: "space-between",
  },
  logo: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  logoText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  logoSubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  nav: {
    flex: 1,
    paddingHorizontal: 12,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 2,
  },
  navLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginLeft: 10,
    flex: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    borderTopWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  userInitial: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  userName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  userRole: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
