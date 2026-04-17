import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, ScrollView, StyleSheet, Platform, ActivityIndicator, RefreshControl, useWindowDimensions, Text, TouchableOpacity, FlatList, Modal, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { KpiCard } from "@/components/KpiCard";
import { BudgetTable } from "@/components/BudgetTable";
import { AlertCard } from "@/components/AlertCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { BarChart } from "@/components/BarChart";
import { LineChart } from "@/components/LineChart";
import { DonutChart } from "@/components/DonutChart";
import { ProjectionBarChart } from "@/components/ProjectionBarChart";
import { EventsGantt } from "@/components/EventsGantt";
import { TimelineExpenditureChart, type TimelineCategory } from "@/components/TimelineExpenditureChart";
import { useToast } from "@/contexts/ToastContext";
import Svg, { Rect, Text as SvgText, G } from "react-native-svg";
import {
  useGetDashboardSummary,
  useListBudgetLinesWithMonthly,
  useListAlerts,
  useGetDashboardCharts,
  useGetProjections,
  useListEvents,
  useListImports,
  useResolveAlert,
  useSeedData,
  useEvaluateAlerts,
  useCreateSnapshot,
  getGetDashboardSummaryQueryKey,
  getListBudgetLinesWithMonthlyQueryKey,
  getListAlertsQueryKey,
  getGetDashboardChartsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) {
    return "\u00a3" + (val / 1000000).toFixed(2) + "M";
  }
  if (Math.abs(val) >= 1000) {
    return "\u00a3" + (val / 1000).toFixed(1) + "k";
  }
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

const CHART_COLORS = ["#1e6b4e", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function RemainingBudgetChart({ categories, width, title = "Remaining Budget by Category" }: { categories: { category: string; planned: number; actual: number }[]; width: number; title?: string }) {
  const colors = useColors();
  const barHeight = 24;
  const labelWidth = 130;
  const chartWidth = width - labelWidth - 60;
  const rowHeight = barHeight + 12;
  const height = categories.length * rowHeight + 20;
  const maxVal = Math.max(...categories.map(c => c.planned), 1);

  return (
    <View>
      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 12 }}>{title}</Text>
      <Svg width={width} height={height}>
        {categories.map((c, i) => {
          const y = i * rowHeight + 5;
          const plannedW = (c.planned / maxVal) * chartWidth;
          const spentW = (c.actual / maxVal) * chartWidth;
          const remaining = c.planned - c.actual;
          return (
            <G key={i}>
              <SvgText x={0} y={y + barHeight / 2 + 4} fontSize={11} fill={colors.foreground}>{c.category.length > 16 ? c.category.slice(0, 16) + "\u2026" : c.category}</SvgText>
              <Rect x={labelWidth} y={y} width={Math.max(plannedW, 2)} height={barHeight} fill={colors.border} rx={4} />
              <Rect x={labelWidth} y={y} width={Math.max(spentW, 1)} height={barHeight} fill={remaining >= 0 ? colors.primary : colors.destructive} rx={4} />
              <SvgText x={labelWidth + Math.max(plannedW, 2) + 6} y={y + barHeight / 2 + 4} fontSize={10} fill={remaining >= 0 ? colors.success : colors.destructive}>
                {formatCurrency(remaining)}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const EXTRA_CHART_TABS = ["Projections", "Events"] as const;
type ExtraChartTab = (typeof EXTRA_CHART_TABS)[number];

const SESSION_KEY = "hbt_auto_open_snapshot_saved";
let nativeAutoOpenFired = false;

function DashboardContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";
  const { width: windowWidth } = useWindowDimensions();

  const router = useRouter();
  const [extraTab, setExtraTab] = useState<ExtraChartTab>("Projections");
  const [breakdownGroup, setBreakdownGroup] = useState<"category" | "channel">("category");
  const [mobileChartIndex, setMobileChartIndex] = useState(0);
  const mobileScrollRef = useRef<ScrollView | null>(null);

  const { showToast } = useToast();

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } = useGetDashboardSummary();
  const { data: budgetLines, isLoading: linesLoading, isError: linesError, refetch: refetchLines } = useListBudgetLinesWithMonthly();
  const { data: alerts, refetch: refetchAlerts } = useListAlerts({ resolved: false });
  const { data: charts, refetch: refetchCharts } = useGetDashboardCharts();
  const { data: projections } = useGetProjections();
  const { data: events } = useListEvents();
  const { data: imports } = useListImports();

  const seedMutation = useSeedData();
  const evaluateAlertsMutation = useEvaluateAlerts();
  const resolveMutation = useResolveAlert();
  const createSnapshot = useCreateSnapshot();
  const [snapSaving, setSnapSaving] = useState(false);
  const [showSnapModal, setShowSnapModal] = useState(false);
  const [snapLabel, setSnapLabel] = useState("");

  const fireAutoOpen = useCallback(() => {
    if (Platform.OS === "web") {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } else {
      if (nativeAutoOpenFired) return;
      nativeAutoOpenFired = true;
    }
    createSnapshot.mutate({ data: { label: "auto-open" } }, {
      onSuccess: () => showToast("Auto snapshot saved on open"),
      onError: () => {},
    });
  }, [createSnapshot, showToast]);

  useEffect(() => {
    fireAutoOpen();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = () => {
      try {
        fetch("/api/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "auto-close" }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const handleSaveSnapshot = useCallback(() => {
    setSnapLabel("");
    setShowSnapModal(true);
  }, []);

  const handleConfirmSnapSave = useCallback(() => {
    const label = snapLabel.trim() || "manual";
    setSnapSaving(true);
    createSnapshot.mutate({ data: { label } }, {
      onSuccess: () => {
        setShowSnapModal(false);
        setSnapLabel("");
        showToast("Snapshot saved");
      },
      onError: () => showToast("Failed to save snapshot"),
      onSettled: () => setSnapSaving(false),
    });
  }, [snapLabel, createSnapshot, showToast]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchLines(), refetchAlerts(), refetchCharts()]);
    setRefreshing(false);
  };

  const handleSeed = () => {
    seedMutation.mutate(undefined, {
      onSuccess: () => {
        evaluateAlertsMutation.mutate({}, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
          },
          onError: () => {
            showToast("Failed to evaluate alerts after seeding.");
          },
        });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardChartsQueryKey() });
      },
      onError: () => {
        showToast("Failed to seed sample data. Please try again.");
      },
    });
  };

  const handleResolveAlert = (id: number) => {
    resolveMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
      onError: () => {
        showToast("Failed to resolve alert. Please try again.");
      },
    });
  };

  const isLoading = summaryLoading || linesLoading;
  const hasError = summaryError || linesError;

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
      channel: (line as { channel?: string | null }).channel ?? null,
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

  if (hasError && !hasData) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ErrorState
          title="Failed to load dashboard"
          message="We couldn't fetch your budget data. Check your connection and try again."
          onRetry={handleRefresh}
        />
      </View>
    );
  }

  const desktopContentWidth = windowWidth - 240 - 96;
  const chartHalfWidth = isDesktop ? Math.min((desktopContentWidth - 16) / 2, 500) : windowWidth - 32;
  const chartFullWidth = isDesktop ? Math.min(desktopContentWidth, 900) : windowWidth - 32;
  const donutSize = isDesktop ? 180 : 160;

  const monthlyData = charts?.monthly ?? [];
  const categoryData = charts?.categories ?? [];
  const channelData = charts?.channels ?? [];
  const formatChannelLabel = (ch: string) => ch === "unassigned" ? "Unassigned" : ch.charAt(0).toUpperCase() + ch.slice(1);
  const breakdownData = breakdownGroup === "category"
    ? categoryData.map(c => ({ label: c.category, planned: c.planned, actual: c.actual }))
    : channelData.map(c => ({ label: formatChannelLabel(c.channel), planned: c.planned, actual: c.actual }));

  const projectionItems = projections?.items ?? [];
  const projectionMonthly = MONTH_LABELS.map((label, i) => {
    const month = i + 1;
    let totalActual = 0;
    let totalProjected = 0;
    let totalPlanned = 0;
    for (const item of projectionItems) {
      const m = item.months?.find((mo: { month: number }) => mo.month === month);
      if (m) {
        totalActual += m.actual ?? 0;
        totalProjected += m.projected ?? 0;
        totalPlanned += m.planned ?? 0;
      }
    }
    return { label, actual: totalActual, projected: totalProjected, planned: totalPlanned };
  });

  const FY_YEAR = 2026;
  const now = new Date();
  const currentMonth = now.getFullYear() === FY_YEAR ? now.getMonth() + 1 : 6;

  const timelineCategories: TimelineCategory[] = (() => {
    const map = new Map<string, { planned: number; spent: number; months: Set<number> }>();
    for (const line of linesArray) {
      const entry = map.get(line.category) ?? { planned: 0, spent: 0, months: new Set<number>() };
      for (const p of (line.plans || [])) {
        if ((p.plannedAmount || 0) > 0) {
          entry.planned += p.plannedAmount || 0;
          entry.months.add(p.month);
        }
      }
      for (const a of (line.actuals || [])) {
        if ((a.month || 0) <= currentMonth) {
          entry.spent += a.actualAmount || 0;
        }
      }
      map.set(line.category, entry);
    }
    const rows: TimelineCategory[] = [];
    for (const [category, v] of map) {
      if (v.planned <= 0) continue;
      const months = Array.from(v.months);
      const start = months.length ? Math.min(...months) : 1;
      const end = months.length ? Math.max(...months) : 12;
      rows.push({
        category,
        planned: v.planned,
        spent: v.spent,
        plannedStartMonth: start,
        plannedEndMonth: end,
      });
    }
    rows.sort((a, b) => b.planned - a.planned);
    return rows;
  })();

  const eventsArray = Array.isArray(events) ? events : [];
  const eventItems = eventsArray.map((evt) => {
    const d = evt.eventDate ? new Date(evt.eventDate) : null;
    return {
      name: evt.name,
      month: d ? d.getMonth() + 1 : 1,
      status: evt.status ?? "Planned",
      budget: evt.estimatedCost ?? 0,
    };
  }).sort((a, b) => a.month - b.month);

  const MOBILE_CHART_TABS = ["Plan vs Actual", "Cumulative", "Categories", "Channels", "Remaining", "Timeline", "Projections", "Events"] as const;

  const renderMobileChart = (tab: string) => {
    const w = windowWidth - 32;
    switch (tab) {
      case "Plan vs Actual":
        return <BarChart data={monthlyData.map(m => ({ label: m.monthLabel, planned: m.planned, actual: m.actual }))} width={w} height={220} />;
      case "Cumulative":
        return <LineChart data={monthlyData.map(m => ({ label: m.monthLabel, cumPlanned: m.cumPlanned, cumActual: m.cumActual }))} width={w} height={220} />;
      case "Categories":
        return <DonutChart data={categoryData.map(c => ({ category: c.category, value: c.planned }))} size={donutSize} />;
      case "Channels":
        return channelData.length > 0
          ? <BarChart data={channelData.map(c => ({ label: formatChannelLabel(c.channel), planned: c.planned, actual: c.actual }))} width={w} height={220} />
          : <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 40 }}>No channel data yet. Tag budget lines with a channel to see this chart.</Text>;
      case "Remaining":
        return <RemainingBudgetChart categories={breakdownData.map(c => ({ category: c.label, planned: c.planned, actual: c.actual }))} width={w} title={breakdownGroup === "category" ? "Remaining Budget by Category" : "Remaining Budget by Channel"} />;
      case "Timeline":
        return timelineCategories.length > 0
          ? <TimelineExpenditureChart categories={timelineCategories} currentMonth={currentMonth} width={w} />
          : <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 40 }}>No planned spend yet.</Text>;
      case "Projections":
        return <ProjectionBarChart data={projectionMonthly} width={w} height={220} />;
      case "Events":
        return <EventsGantt events={eventItems} width={w} height={Math.max(180, eventItems.length * 36 + 60)} />;
      default:
        return null;
    }
  };

  const mobileChartWidth = windowWidth - 32;

  const content = (
    <View style={{ flex: 1 }}>
    <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
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
          <View style={styles.overviewHeaderRow}>
            <View style={{ flex: 1 }}>
              <SectionHeader title="Budget Overview" subtitle="FY26 Marketing Budget" />
            </View>
            <TouchableOpacity
              style={[styles.snapBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleSaveSnapshot}
              disabled={snapSaving}
              activeOpacity={0.8}
            >
              {snapSaving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="camera" size={12} color={colors.primary} />
                  <Text style={[styles.snapBtnText, { color: colors.primary }]}>Save Snapshot</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <View style={[styles.kpiRow, { flexDirection: isDesktop ? "row" : "column" }]}>
            <KpiCard title="Total Budget" value={formatCurrency(summary?.totalBudget ?? 0)} icon="target" color={colors.primary} />
            <KpiCard title="Spent YTD" value={formatCurrency(summary?.spentYtd ?? 0)} icon="credit-card" color={colors.accent} trend={summary && summary.budgetUtilisation > 80 ? "down" : "neutral"} />
            <KpiCard title="Remaining" value={formatCurrency(summary?.remaining ?? 0)} icon="shield" color={colors.success} />
            <KpiCard title="Fixed Run Rate" value={formatCurrency(summary?.fixedRunRate ?? 0)} subtitle="/month" icon="repeat" color={colors.primary} />
          </View>

          {monthlyData.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Charts" subtitle="Budget visualisations" />
              {isDesktop ? (
                <>
                  <View style={styles.chartsRow}>
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                      <BarChart
                        data={monthlyData.map(m => ({ label: m.monthLabel, planned: m.planned, actual: m.actual }))}
                        width={chartHalfWidth}
                        height={260}
                      />
                    </View>
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                      <LineChart
                        data={monthlyData.map(m => ({ label: m.monthLabel, cumPlanned: m.cumPlanned, cumActual: m.cumActual }))}
                        width={chartHalfWidth}
                        height={260}
                      />
                    </View>
                  </View>
                  <View style={styles.breakdownToggleRow}>
                    <Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>Group by:</Text>
                    {(["category", "channel"] as const).map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => setBreakdownGroup(opt)}
                        style={[
                          styles.breakdownToggleBtn,
                          {
                            backgroundColor: breakdownGroup === opt ? colors.primary : "transparent",
                            borderColor: breakdownGroup === opt ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: breakdownGroup === opt ? colors.primaryForeground : colors.foreground }}>
                          {opt === "category" ? "Category" : "Channel"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.chartsRow}>
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, alignSelf: "flex-start" }]}>
                      {breakdownGroup === "channel" && channelData.length === 0 ? (
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, padding: 20, width: donutSize * 1.2 }}>No channel data yet. Tag budget lines with a channel to see this chart.</Text>
                      ) : (
                        <DonutChart
                          data={breakdownData.map(c => ({ category: c.label, value: c.planned }))}
                          size={donutSize}
                        />
                      )}
                    </View>
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                      {breakdownGroup === "channel" && channelData.length === 0 ? (
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, padding: 20 }}>No channel data yet.</Text>
                      ) : (
                        <RemainingBudgetChart
                          categories={breakdownData.map(c => ({ category: c.label, planned: c.planned, actual: c.actual }))}
                          width={chartHalfWidth}
                          title={breakdownGroup === "category" ? "Remaining Budget by Category" : "Remaining Budget by Channel"}
                        />
                      )}
                    </View>
                  </View>
                  {timelineCategories.length > 0 && (
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                      <TimelineExpenditureChart
                        categories={timelineCategories}
                        currentMonth={currentMonth}
                        width={chartFullWidth}
                      />
                    </View>
                  )}
                  <View style={styles.extraSection}>
                    <View style={styles.tabRow}>
                      {EXTRA_CHART_TABS.map((tab) => (
                        <TouchableOpacity
                          key={tab}
                          onPress={() => setExtraTab(tab)}
                          style={[
                            styles.tab,
                            extraTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                          ]}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.tabText, { color: extraTab === tab ? colors.primary : colors.mutedForeground }]}>{tab}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      {extraTab === "Projections" ? (
                        <ProjectionBarChart data={projectionMonthly} width={chartFullWidth} height={260} />
                      ) : (
                        <EventsGantt events={eventItems} width={chartFullWidth} height={Math.max(180, eventItems.length * 36 + 60)} />
                      )}
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <ScrollView
                    ref={mobileScrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const idx = Math.round(
                        e.nativeEvent.contentOffset.x /
                          Math.max(e.nativeEvent.layoutMeasurement.width, 1)
                      );
                      setMobileChartIndex(
                        Math.max(0, Math.min(idx, MOBILE_CHART_TABS.length - 1))
                      );
                    }}
                    onMomentumScrollEnd={(e) => {
                      const idx = Math.round(e.nativeEvent.contentOffset.x / mobileChartWidth);
                      setMobileChartIndex(idx);
                    }}
                    style={styles.chartPager}
                  >
                    {MOBILE_CHART_TABS.map((tab) => (
                      <View key={tab} style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border, width: mobileChartWidth - 8 }]}>
                        {renderMobileChart(tab)}
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.pagerDots}>
                    {MOBILE_CHART_TABS.map((tab, i) => (
                      <View key={tab} style={[styles.dot, { backgroundColor: i === mobileChartIndex ? colors.primary : colors.border }]} />
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

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

          {!isDesktop && imports && imports.length > 0 && (() => {
            const pendingImports = imports.filter((i: { status: string }) => i.status !== "confirmed");
            const latestImport = imports[imports.length - 1] as { filename: string; status: string; totalRows: number; matchedRows: number; unmatchedRows: number; createdAt: string };
            return (
              <View style={styles.section}>
                <SectionHeader title="Recent Imports" subtitle={pendingImports.length > 0 ? `${pendingImports.length} pending` : "All confirmed"} />
                <TouchableOpacity
                  onPress={() => router.push("/import")}
                  style={[styles.importStatusCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={[styles.importIcon, { backgroundColor: colors.primary + "15" }]}>
                        <Feather name="upload-cloud" size={18} color={colors.primary} />
                      </View>
                      <View>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{latestImport.filename}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                          {latestImport.matchedRows}/{latestImport.totalRows} matched
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.importBadge, { backgroundColor: latestImport.status === "confirmed" ? "#dcfce7" : "#fef3c7" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: latestImport.status === "confirmed" ? "#16a34a" : "#d97706" }}>
                        {latestImport.status === "confirmed" ? "Confirmed" : "Pending"}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })()}

          {isDesktop && (
            <View style={styles.section}>
              <SectionHeader title="Budget Lines" subtitle={`${tableData.length} line items`} />
              <BudgetTable data={tableData} />
            </View>
          )}
        </>
      )}
    </ScrollView>
    </View>
  );

  const snapModal = (
    <Modal
      visible={showSnapModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowSnapModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Feather name="camera" size={18} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Save Snapshot</Text>
          </View>
          <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
            Enter an optional label (e.g. "before Q2 reforecast")
          </Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
            placeholder="manual"
            placeholderTextColor={colors.mutedForeground}
            value={snapLabel}
            onChangeText={setSnapLabel}
            autoFocus
            maxLength={40}
            onSubmitEditing={handleConfirmSnapSave}
            returnKeyType="done"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.muted }]}
              onPress={() => setShowSnapModal(false)}
            >
              <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              onPress={handleConfirmSnapSave}
              disabled={snapSaving}
            >
              {snapSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={activeAlerts.length} />
        <View style={styles.desktopContent}>{content}</View>
        {snapModal}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {content}
      {snapModal}
    </View>
  );
}

export default function TabOneScreen() {
  return <DashboardContent />;
}

const styles = StyleSheet.create({
  overviewHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  snapBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  snapBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalBox: { width: "100%", maxWidth: 440, borderRadius: 16, borderWidth: 1, padding: 24, gap: 14 },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, lineHeight: 18 },
  modalInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: "center" },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  chartsRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
  },
  breakdownToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  breakdownLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  breakdownToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  extraSection: {
    marginTop: 16,
  },
  tabRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  chartCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  chartPager: {
    marginTop: 8,
  },
  pagerDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
  importStatusCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  importIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  importBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
});
