import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, TouchableOpacity, Text } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useTheme } from "@/contexts/ThemeContext";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="budget">
        <Icon sf={{ default: "list.bullet", selected: "list.bullet" }} />
        <Label>Budget</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts">
        <Icon sf={{ default: "bell", selected: "bell.fill" }} />
        <Label>Alerts</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="events">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>Events</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="event-mgmnt">
        <Icon sf={{ default: "checklist", selected: "checklist" }} />
        <Label>Evt Mgmt</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="quarterly">
        <Icon sf={{ default: "chart.bar.xaxis", selected: "chart.bar.xaxis" }} />
        <Label>Quarterly</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="annual">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>Annual</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="monthly">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>Monthly</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reports">
        <Icon sf={{ default: "chart.pie", selected: "chart.pie.fill" }} />
        <Label>Reports</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reforecast" hidden>
        <Icon sf={{ default: "arrow.triangle.2.circlepath", selected: "arrow.triangle.2.circlepath" }} />
        <Label>Reforecast</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="audit" hidden>
        <Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
        <Label>Audit</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="import" hidden>
        <Icon sf={{ default: "square.and.arrow.up", selected: "square.and.arrow.up.fill" }} />
        <Label>Import</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="excel" hidden>
        <Icon sf={{ default: "tablecells", selected: "tablecells.fill" }} />
        <Label>Excel</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="categories" hidden>
        <Icon sf={{ default: "tag", selected: "tag.fill" }} />
        <Label>Categories</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="snapshots" hidden>
        <Icon sf={{ default: "archivebox", selected: "archivebox.fill" }} />
        <Label>Snapshots</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="owners">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Admin</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="board">
        <Icon sf={{ default: "rectangle.on.rectangle", selected: "rectangle.on.rectangle.fill" }} />
        <Label>Board</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function MobileThemeFab() {
  const colors = useColors();
  const { preference, cyclePreference } = useTheme();
  const icon: keyof typeof Feather.glyphMap =
    preference === "light" ? "sun" : preference === "dark" ? "moon" : "monitor";
  return (
    <TouchableOpacity
      onPress={cyclePreference}
      activeOpacity={0.75}
      accessibilityLabel="Toggle theme"
      style={{
        position: "absolute",
        top: Platform.OS === "ios" ? 56 : 16,
        right: 12,
        zIndex: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <Feather name={icon} size={13} color={colors.foreground} />
      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.foreground, textTransform: "capitalize" }}>{preference}</Text>
    </TouchableOpacity>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { resolvedScheme } = useTheme();
  const { mode } = useLayout();
  const isDark = resolvedScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const isDesktop = mode === "desktop";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: isDesktop
          ? { display: "none" }
          : {
              position: "absolute",
              backgroundColor: isIOS ? "transparent" : colors.background,
              borderTopWidth: isWeb ? 1 : 0,
              borderTopColor: colors.border,
              elevation: 0,
              ...(isWeb ? { height: 84 } : {}),
            },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.bar" tintColor={color} size={24} />
            ) : (
              <Feather name="bar-chart-2" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="list.bullet" tintColor={color} size={24} />
            ) : (
              <Feather name="list" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bell" tintColor={color} size={24} />
            ) : (
              <Feather name="bell" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ) : (
              <Feather name="calendar" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="event-mgmnt"
        options={{
          title: "Evt Mgmt",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="checklist" tintColor={color} size={24} />
            ) : (
              <Feather name="clipboard" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="quarterly"
        options={{
          title: "Quarterly",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.bar.xaxis" tintColor={color} size={24} />
            ) : (
              <Feather name="columns" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="annual"
        options={{
          title: "Annual",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) => <Feather name="calendar" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="monthly"
        options={{
          title: "Monthly",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.pie" tintColor={color} size={24} />
            ) : (
              <Feather name="pie-chart" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="reforecast"
        options={{
          title: "Reforecast",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="arrow.triangle.2.circlepath" tintColor={color} size={24} />
            ) : (
              <Feather name="refresh-cw" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="audit"
        options={{
          title: "Audit",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="doc.text" tintColor={color} size={24} />
            ) : (
              <Feather name="file-text" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: "Import",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="square.and.arrow.up" tintColor={color} size={24} />
            ) : (
              <Feather name="upload" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="excel"
        options={{
          title: "Excel",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="board"
        options={{
          title: "Board",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="rectangle.on.rectangle" tintColor={color} size={24} />
            ) : (
              <Feather name="monitor" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: "Categories",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) => <Feather name="tag" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="snapshots"
        options={{
          title: "Snapshots",
          tabBarItemStyle: { display: "none" },
          tabBarIcon: ({ color }) => <Feather name="archive" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="owners"
        options={{
          title: "Admin",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const tabs = isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
  return (
    <View style={{ flex: 1 }}>
      {tabs}
      {!isDesktop && <MobileThemeFab />}
    </View>
  );
}
