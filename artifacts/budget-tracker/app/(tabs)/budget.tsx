import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Text, Platform, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { BudgetTable } from "@/components/BudgetTable";
import { EmptyState } from "@/components/EmptyState";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000) {
    return "\u00a3" + (val / 1000).toFixed(1) + "k";
  }
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function BudgetContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const { data: budgetLines, isLoading, refetch } = useListBudgetLinesWithMonthly();
  const { data: alerts } = useListAlerts({ resolved: false });
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const tableData = (budgetLines || []).map((line) => {
    const totalPlan = (line.plans || []).reduce((sum, p) => sum + (p.plannedAmount || 0), 0);
    const totalActual = (line.actuals || []).reduce((sum, a) => sum + (a.actualAmount || 0), 0);
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

  const categories = [...new Set(tableData.map((d) => d.category))];

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
      <SectionHeader title="Budget Lines" subtitle={`${tableData.length} line items across ${categories.length} categories`} />

      {tableData.length === 0 ? (
        <EmptyState icon="list" title="No budget lines" message="Budget line items will appear here once data is seeded." />
      ) : isDesktop ? (
        <BudgetTable data={tableData} />
      ) : (
        <View style={styles.mobileList}>
          {categories.map((cat) => {
            const catItems = tableData.filter((d) => d.category === cat);
            const catTotal = catItems.reduce((s, d) => s + d.totalPlan, 0);
            return (
              <View key={cat} style={styles.categoryGroup}>
                <View style={styles.categoryHeader}>
                  <Text style={[styles.categoryName, { color: colors.foreground }]}>{cat}</Text>
                  <Text style={[styles.categoryTotal, { color: colors.mutedForeground }]}>{formatCurrency(catTotal)}</Text>
                </View>
                {catItems.map((item) => {
                  const varianceColor = item.variance > 0 ? colors.success : item.variance < 0 ? colors.destructive : colors.foreground;
                  return (
                    <View key={item.id} style={[styles.mobileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                      <View style={styles.mobileCardTop}>
                        <Text style={[styles.mobileItemName, { color: colors.foreground }]} numberOfLines={1}>{item.lineItem}</Text>
                        <View style={[styles.mobileBadge, { backgroundColor: item.costStatus === "Fixed Cost" ? colors.primary + "15" : colors.accent + "20" }]}>
                          <Text style={[styles.mobileBadgeText, { color: item.costStatus === "Fixed Cost" ? colors.primary : colors.accent }]}>
                            {item.costStatus === "Fixed Cost" ? "Fixed" : "Var"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.mobileCardBottom}>
                        <View style={styles.mobileMetric}>
                          <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Plan</Text>
                          <Text style={[styles.mobileMetricValue, { color: colors.foreground }]}>{formatCurrency(item.totalPlan)}</Text>
                        </View>
                        <View style={styles.mobileMetric}>
                          <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Actual</Text>
                          <Text style={[styles.mobileMetricValue, { color: colors.foreground }]}>{formatCurrency(item.totalActual)}</Text>
                        </View>
                        <View style={styles.mobileMetric}>
                          <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Variance</Text>
                          <Text style={[styles.mobileMetricValue, { color: varianceColor }]}>{formatCurrency(item.variance)}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(alerts || []).length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return content;
}

export default function BudgetScreen() {
  return <BudgetContent />;
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
  mobileList: {
    gap: 16,
  },
  categoryGroup: {
    gap: 8,
  },
  categoryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  categoryName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  categoryTotal: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  mobileCard: {
    borderWidth: 1,
    padding: 12,
  },
  mobileCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  mobileItemName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    flex: 1,
    marginRight: 8,
  },
  mobileBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mobileBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  mobileCardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  mobileMetric: {
    alignItems: "center",
  },
  mobileMetricLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
  },
  mobileMetricValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
});
