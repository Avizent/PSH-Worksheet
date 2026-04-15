import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Platform, ActivityIndicator, RefreshControl, Text, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { AlertCard } from "@/components/AlertCard";
import { EmptyState } from "@/components/EmptyState";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import {
  useListAlerts,
  useResolveAlert,
  getListAlertsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function AlertsContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const queryClient = useQueryClient();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const [showResolved, setShowResolved] = useState(false);

  const { data: activeAlerts, isLoading: activeLoading, refetch: refetchActive } = useListAlerts({ resolved: false });
  const { data: resolvedAlerts, isLoading: resolvedLoading, refetch: refetchResolved } = useListAlerts({ resolved: true });

  const resolveMutation = useResolveAlert();

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchActive(), refetchResolved()]);
    setRefreshing(false);
  };

  const handleResolve = (id: number) => {
    resolveMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  };

  if (activeLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const alerts = showResolved ? (resolvedAlerts || []) : (activeAlerts || []);

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");
  const infoAlerts = alerts.filter((a) => a.severity === "info");

  const renderGroup = (title: string, items: typeof alerts) => {
    if (items.length === 0) return null;
    return (
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>{title} ({items.length})</Text>
        {items.map((alert) => (
          <AlertCard
            key={alert.id}
            type={alert.type}
            severity={alert.severity}
            message={alert.message}
            resolved={showResolved}
            onResolve={showResolved ? undefined : () => handleResolve(alert.id)}
          />
        ))}
      </View>
    );
  };

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingTop: isWeb ? 67 : 0,
          paddingBottom: isWeb ? 34 : 20,
          paddingHorizontal: isDesktop ? 32 : 16,
        },
      ]}
      refreshControl={
        Platform.OS !== "web" ? (
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      <View style={styles.headerRow}>
        <SectionHeader title="Alerts" subtitle={`${(activeAlerts || []).length} active`} />
        <View style={styles.toggleRow}>
          <TouchableOpacity
            onPress={() => setShowResolved(false)}
            style={[styles.toggleButton, !showResolved && { backgroundColor: colors.primary }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.toggleText, { color: !showResolved ? colors.primaryForeground : colors.mutedForeground }]}>Active</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowResolved(true)}
            style={[styles.toggleButton, showResolved && { backgroundColor: colors.primary }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.toggleText, { color: showResolved ? colors.primaryForeground : colors.mutedForeground }]}>Resolved</Text>
          </TouchableOpacity>
        </View>
      </View>

      {alerts.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={showResolved ? "No resolved alerts" : "All clear"}
          message={showResolved ? "No alerts have been resolved yet." : "No active alerts at this time."}
        />
      ) : (
        <>
          {renderGroup("Critical", criticalAlerts)}
          {renderGroup("Warnings", warningAlerts)}
          {renderGroup("Information", infoAlerts)}
        </>
      )}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(activeAlerts || []).length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return content;
}

export default function AlertsScreen() {
  return <AlertsContent />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  toggleRow: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
  },
  toggleButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  group: {
    marginBottom: 8,
  },
  groupTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
});
