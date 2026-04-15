import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Platform, ActivityIndicator, RefreshControl, Text, TouchableOpacity, Modal, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { AlertCard } from "@/components/AlertCard";
import { SwipeableAlertCard } from "@/components/SwipeableAlertCard";
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

const SEVERITY_OPTIONS = ["all", "critical", "warning", "info"] as const;
type SeverityFilter = (typeof SEVERITY_OPTIONS)[number];

interface AlertItem {
  id: number;
  type: string;
  severity: string;
  message: string;
  month?: number | null;
  year?: number | null;
  createdAt?: string | null;
}

function AlertsContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const queryClient = useQueryClient();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const [showResolved, setShowResolved] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);

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
        setSelectedAlert(null);
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

  const allAlerts = showResolved ? (resolvedAlerts || []) : (activeAlerts || []);
  const alerts = severityFilter === "all" ? allAlerts : allAlerts.filter((a) => a.severity === severityFilter);

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");
  const infoAlerts = alerts.filter((a) => a.severity === "info");

  const severityColors: Record<string, string> = {
    critical: colors.destructive,
    warning: colors.warning,
    info: colors.primary,
  };

  const renderGroup = (title: string, items: typeof alerts) => {
    if (items.length === 0) return null;
    return (
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>{title} ({items.length})</Text>
        {items.map((alert) => (
          <View key={alert.id}>
            {isDesktop ? (
              <AlertCard
                type={alert.type}
                severity={alert.severity}
                message={alert.message}
                resolved={showResolved}
                onResolve={showResolved ? undefined : () => handleResolve(alert.id)}
              />
            ) : (
              <TouchableOpacity activeOpacity={0.8} onPress={() => setSelectedAlert(alert as AlertItem)}>
                <SwipeableAlertCard
                  type={alert.type}
                  severity={alert.severity}
                  message={alert.message}
                  resolved={showResolved}
                  onResolve={showResolved ? undefined : () => handleResolve(alert.id)}
                />
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!isDesktop && !showResolved && items.length > 0 && (
          <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>Swipe left to resolve</Text>
        )}
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
        <View style={styles.controlsRow}>
          {isDesktop && (
            <View style={styles.filterRow}>
              {SEVERITY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setSeverityFilter(opt)}
                  style={[
                    styles.filterChip,
                    severityFilter === opt && { backgroundColor: opt === "all" ? colors.primary : severityColors[opt] + "20", borderColor: opt === "all" ? colors.primary : severityColors[opt] },
                    { borderColor: severityFilter === opt ? (opt === "all" ? colors.primary : severityColors[opt]) : colors.border },
                  ]}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.filterText,
                    { color: severityFilter === opt ? (opt === "all" ? colors.primaryForeground : severityColors[opt]) : colors.mutedForeground },
                  ]}>
                    {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
      </View>

      {alerts.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={showResolved ? "No resolved alerts" : severityFilter !== "all" ? `No ${severityFilter} alerts` : "All clear"}
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

  const alertDetail = selectedAlert ? (
    <Modal
      visible={!!selectedAlert}
      transparent
      animationType="slide"
      onRequestClose={() => setSelectedAlert(null)}
    >
      <Pressable style={styles.modalOverlay} onPress={() => setSelectedAlert(null)}>
        <Pressable style={[styles.modalContent, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Feather
              name={selectedAlert.severity === "critical" ? "alert-circle" : selectedAlert.severity === "warning" ? "alert-triangle" : "info"}
              size={24}
              color={severityColors[selectedAlert.severity] || colors.primary}
            />
            <Text style={[styles.modalType, { color: severityColors[selectedAlert.severity] || colors.primary }]}>
              {selectedAlert.type.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.modalSeverity, { color: severityColors[selectedAlert.severity] || colors.mutedForeground }]}>
            Severity: {selectedAlert.severity}
          </Text>
          <Text style={[styles.modalMessage, { color: colors.foreground }]}>{selectedAlert.message}</Text>
          {selectedAlert.month && (
            <Text style={[styles.modalMeta, { color: colors.mutedForeground }]}>
              Month: {selectedAlert.month} / Year: {selectedAlert.year}
            </Text>
          )}
          {!showResolved && (
            <TouchableOpacity
              onPress={() => handleResolve(selectedAlert.id)}
              style={[styles.resolveButton, { backgroundColor: colors.success }]}
              activeOpacity={0.7}
            >
              <Feather name="check" size={16} color="#fff" />
              <Text style={styles.resolveButtonText}>Resolve Alert</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setSelectedAlert(null)} style={styles.closeButton} activeOpacity={0.7}>
            <Text style={[styles.closeButtonText, { color: colors.mutedForeground }]}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  ) : null;

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(activeAlerts || []).length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return (
    <>
      {content}
      {alertDetail}
    </>
  );
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
    flexWrap: "wrap",
    gap: 8,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
  swipeHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 2,
    fontStyle: "italic",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#d1d5db",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  modalType: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  modalSeverity: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
    marginBottom: 12,
  },
  modalMeta: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  resolveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  resolveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  closeButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  closeButtonText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
});
