import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, usePathname, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";

interface NavItem {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: Href;
}

const MAIN_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "bar-chart-2", route: "/" },
  { key: "budget", label: "Budget Lines", icon: "list", route: "/budget" },
  { key: "quarterly", label: "Quarterly", icon: "columns", route: "/quarterly" },
  { key: "annual", label: "Annual View", icon: "calendar", route: "/annual" },
  { key: "monthly", label: "Monthly View", icon: "clock", route: "/monthly" },
  { key: "reports", label: "Reports", icon: "pie-chart", route: "/reports" },
  { key: "alerts", label: "Alerts", icon: "bell", route: "/alerts" },
  { key: "events", label: "Events", icon: "calendar", route: "/events" },
  { key: "event-mgmnt", label: "Event Mgmnt", icon: "clipboard", route: "/event-mgmnt" },
  { key: "board", label: "Board View", icon: "monitor", route: "/board" },
];

const ADMIN_ITEMS: NavItem[] = [
  { key: "owners", label: "Owners", icon: "users", route: "/owners" },
  { key: "categories", label: "Categories", icon: "tag", route: "/categories" },
  { key: "columns", label: "Custom Columns", icon: "columns", route: "/columns" },
  { key: "import", label: "Import", icon: "upload", route: "/import" },
  { key: "audit", label: "Audit Log", icon: "file-text", route: "/audit" },
  { key: "reforecast", label: "Reforecast", icon: "refresh-cw", route: "/reforecast" },
  { key: "excel", label: "Excel", icon: "grid", route: "/excel" },
  { key: "snapshots", label: "Snapshots", icon: "archive", route: "/snapshots" },
];

interface DesktopSidebarProps {
  alertCount?: number;
}

export function DesktopSidebar({ alertCount = 0 }: DesktopSidebarProps) {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const { preference, cyclePreference } = useTheme();
  const themeIcon: keyof typeof Feather.glyphMap =
    preference === "light" ? "sun" : preference === "dark" ? "moon" : "monitor";
  const themeLabel = preference === "light" ? "Light" : preference === "dark" ? "Dark" : "System";

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
        {MAIN_ITEMS.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => router.push(item.route)}
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

        <View style={[styles.adminDivider, { borderTopColor: colors.border }]}>
          <Text style={[styles.adminLabel, { color: colors.mutedForeground }]}>ADMIN</Text>
        </View>

        {ADMIN_ITEMS.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => router.push(item.route)}
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
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={cyclePreference}
          style={[styles.themeToggle, { borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Feather name={themeIcon} size={14} color={colors.foreground} />
          <Text style={[styles.themeText, { color: colors.foreground }]}>{themeLabel}</Text>
        </TouchableOpacity>
        <View style={styles.footerUser}>
          <View style={[styles.userAvatar, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[styles.userInitial, { color: colors.primary }]}>VP</Text>
          </View>
          <View>
            <Text style={[styles.userName, { color: colors.foreground }]}>VP Marketing</Text>
            <Text style={[styles.userRole, { color: colors.mutedForeground }]}>Editor</Text>
          </View>
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
  adminDivider: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  adminLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
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
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    borderTopWidth: 1,
    padding: 16,
    gap: 12,
  },
  footerUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  themeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  themeText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
