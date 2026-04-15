import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Platform, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { KpiCard } from "@/components/KpiCard";
import { BudgetTable } from "@/components/BudgetTable";
import { AlertCard } from "@/components/AlertCard";
import { EmptyState } from "@/components/EmptyState";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import {
  useGetDashboardSummary,
  useListBudgetLinesWithMonthly,
  useListAlerts,
  useResolveAlert,
  useSeedData,
  getGetDashboardSummaryQueryKey,
  getListBudgetLinesWithMonthlyQueryKey,
  getListAlertsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) {
    return "\u00a3" + (val / 1000000).toFixed(2) + "M";
  }
  if (Math.abs(val) >= 1000) {
    return "\u00a3" + (val / 1000).toFixed(1) + "k";
  }
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function DashboardContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetDashboardSummary();
  const { data: budgetLines, isLoading: linesLoading, refetch: refetchLines } = useListBudgetLinesWithMonthly();
  const { data: alerts, refetch: refetchAlerts } = useListAlerts({ resolved: false });

  const seedMutation = useSeedData();
  const resolveMutation = useResolveAlert();

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchLines(), refetchAlerts()]);
    setRefreshing(false);
  };

  const handleSeed = () => {
    seedMutation.mutate({ data: undefined as never }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      },
    });
  };

  const handleResolveAlert = (id: number) => {
    resolveMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  };

  const isLoading = summaryLoading || linesLoading;

  const linesArray = Array.isArray(budgetLines) ? budgetLines : [];
  const tableData = linesArray.map((line) => {
    const plans = Array.isArray(line.plans) ? line.plans : [];
    const actuals = Array.isArray(line.actuals) ? line.actuals : [];
    const totalPlan = plans.reduce((sum, p) => sum + (p.plannedAmount || 0), 0);
    const totalActual = actuals.reduce((sum, a) => sum + (a.actualAmount || 0), 0);
    return {
      id: line.id,
      category: line.category,
      lineItem: line.lineItem,
      owner: line.owner ?? null,
      costStatus: line.costStatus,
      totalPlan,
      totalActual,
      variance: totalPlan - totalActual,
    };
  });

  const hasData = tableData.length > 0;
  const activeAlerts = Array.isArray(alerts) ? alerts : [];

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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
      {!hasData ? (
        <EmptyState
          icon="database"
          title="No budget data"
          message="Seed the database with sample marketing budget data to get started."
          actionLabel={seedMutation.isPending ? "Seeding..." : "Seed Sample Data"}
          onAction={handleSeed}
        />
      ) : (
        <>
          <SectionHeader title="Budget Overview" subtitle="FY26 Marketing Budget" />
          <View style={[styles.kpiRow, { flexDirection: isDesktop ? "row" : "column" }]}>
            <KpiCard title="Total Budget" value={formatCurrency(summary?.totalBudget ?? 0)} icon="target" color={colors.primary} />
            <KpiCard title="Spent YTD" value={formatCurrency(summary?.spentYtd ?? 0)} icon="credit-card" color={colors.accent} trend={summary && summary.budgetUtilisation > 80 ? "down" : "neutral"} />
            <KpiCard title="Remaining" value={formatCurrency(summary?.remaining ?? 0)} icon="shield" color={colors.success} />
            <KpiCard title="Fixed Run Rate" value={formatCurrency(summary?.fixedRunRate ?? 0)} subtitle="/month" icon="repeat" color={colors.primary} />
          </View>

          {activeAlerts.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Active Alerts" subtitle={`${activeAlerts.length} alert${activeAlerts.length !== 1 ? "s" : ""} require attention`} />
              {activeAlerts.slice(0, isDesktop ? 5 : 3).map((alert) => (
                <AlertCard
                  key={alert.id}
                  type={alert.type}
                  severity={alert.severity}
                  message={alert.message}
                  onResolve={() => handleResolveAlert(alert.id)}
                />
              ))}
            </View>
          )}

          {isDesktop && (
            <View style={styles.section}>
              <SectionHeader title="Budget Lines" subtitle={`${tableData.length} line items`} />
              <BudgetTable data={tableData} />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={activeAlerts.length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return content;
}

export default function TabOneScreen() {
  return <DashboardContent />;
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
    gap: 16,
  },
  kpiRow: {
    gap: 12,
  },
  section: {
    marginTop: 8,
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
});
