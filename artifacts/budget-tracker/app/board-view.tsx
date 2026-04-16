import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  TouchableOpacity,
  Linking,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SystemThemeProvider } from "@/contexts/ThemeContext";
import { KpiCard } from "@/components/KpiCard";
import { BarChart } from "@/components/BarChart";
import { LineChart } from "@/components/LineChart";
import { DonutChart } from "@/components/DonutChart";
import { ProjectionBarChart } from "@/components/ProjectionBarChart";
import { SectionHeader } from "@/components/SectionHeader";
import { getApiUrl } from "@/utils/getApiUrl";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(2) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

type BoardData = {
  summary: {
    totalBudget: number;
    spentYtd: number;
    remaining: number;
    fixedRunRate: number;
    activeAlerts: number;
    budgetUtilisation: number;
    monthsElapsed: number;
    totalMonths: number;
  };
  charts: {
    monthly: Array<{ month: number; monthLabel: string; planned: number; actual: number; cumPlanned: number; cumActual: number }>;
    categories: Array<{ category: string; planned: number; actual: number }>;
  };
  alerts: Array<{ id: number; type: string; severity: string; message: string }>;
  events: Array<{ id: number; name: string; status: string; eventDate?: string | null; estimatedCost?: number | null }>;
  projections: {
    year: number;
    items: Array<{ months: Array<{ month: number; planned: number; actual: number | null; projected: number | null }> }>;
  };
  visibleSections: string[];
};

export default function BoardViewScreen() {
  return (
    <SystemThemeProvider>
      <BoardViewContent />
    </SystemThemeProvider>
  );
}

function BoardViewContent() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ token: string }>();
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isWide = Platform.OS === "web" && width >= 768;
  const chartWidth = isWide ? Math.min(width - 120, 600) : width - 48;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await fetch(`${baseUrl}/api/board/view?token=${params.token}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Access denied");
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load board view");
      } finally {
        setLoading(false);
      }
    };
    if (params.token) fetchData();
    else { setError("No access token provided"); setLoading(false); }
  }, [params.token]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading board view...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.errorIcon}>
          <Feather name="lock" size={40} color={colors.destructive} />
        </View>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Access Denied</Text>
        <Text style={[styles.errorMessage, { color: colors.mutedForeground }]}>{error || "Unable to load the board view"}</Text>
      </View>
    );
  }

  const handleExport = async (endpoint: string, filename: string) => {
    const baseUrl = getApiUrl();
    const url = `${baseUrl}/api/exports/${endpoint}?token=${params.token}`;
    if (Platform.OS === "web") {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch {
        alert("Export failed. Please try again.");
      }
    } else {
      Linking.openURL(url);
    }
  };

  const visible = new Set(data.visibleSections);
  const s = data.summary;

  const chartMonthly = data.charts.monthly.map(m => ({ label: m.monthLabel, planned: m.planned, actual: m.actual }));
  const chartCumulative = data.charts.monthly.map(m => ({ label: m.monthLabel, plan: m.cumPlanned, actual: m.cumActual }));
  const chartCategories = data.charts.categories.map(c => ({ label: c.category, value: c.actual }));
  const projectionMonthly = MONTH_LABELS.map((label, i) => {
    const m = i + 1;
    let actual = 0, projected = 0, planned = 0;
    for (const item of (data.projections?.items || [])) {
      const md = item.months.find(mo => mo.month === m);
      if (md) { actual += md.actual || 0; projected += md.projected || 0; planned += md.planned || 0; }
    }
    return { label, actual, projected, planned };
  });

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, {
        paddingTop: insets.top + 24,
        paddingHorizontal: isWide ? 48 : 20,
        paddingBottom: insets.bottom + 40,
      }]}
    >
      <View style={styles.header}>
        <View style={[styles.logoMark, { backgroundColor: colors.primary }]}>
          <Feather name="trending-up" size={20} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Hubert Marketing Budget</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>FY2026 Board Report</Text>
      </View>

      {(visible.has("kpi_total_budget") || visible.has("kpi_spent_ytd") || visible.has("kpi_remaining") || visible.has("kpi_fixed_run_rate")) && (
        <View style={[styles.kpiGrid, { flexDirection: isWide ? "row" : "column" }]}>
          {visible.has("kpi_total_budget") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined, backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.kpiValue, { color: colors.foreground }]}>{formatCurrency(s.totalBudget)}</Text>
              <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>TOTAL BUDGET</Text>
            </View>
          )}
          {visible.has("kpi_spent_ytd") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined, backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.kpiValue, { color: colors.foreground }]}>{formatCurrency(s.spentYtd)}</Text>
              <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>SPENT YTD</Text>
              <View style={[styles.utilBar, { backgroundColor: colors.muted }]}>
                <View style={[styles.utilFill, { width: `${Math.min(s.budgetUtilisation, 100)}%`, backgroundColor: colors.primary }]} />
              </View>
              <Text style={[styles.utilText, { color: colors.mutedForeground }]}>{s.budgetUtilisation.toFixed(1)}% utilised</Text>
            </View>
          )}
          {visible.has("kpi_remaining") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined, backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.kpiValue, { color: s.remaining > 0 ? colors.success : colors.destructive }]}>{formatCurrency(s.remaining)}</Text>
              <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>REMAINING</Text>
            </View>
          )}
          {visible.has("kpi_fixed_run_rate") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined, backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.kpiValue, { color: colors.foreground }]}>{formatCurrency(s.fixedRunRate)}</Text>
              <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>FIXED RUN RATE /MONTH</Text>
            </View>
          )}
        </View>
      )}

      {visible.has("chart_plan_vs_actual") && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Plan vs Actual (Monthly)</Text>
          <View style={[styles.boardChartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <BarChart data={chartMonthly} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("chart_cumulative") && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Cumulative Spend vs Plan</Text>
          <View style={[styles.boardChartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <LineChart data={chartCumulative} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("chart_categories") && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Category Breakdown</Text>
          <View style={[styles.boardChartCard, { alignItems: "center", backgroundColor: colors.card, borderColor: colors.border }]}>
            <DonutChart data={chartCategories} size={240} />
          </View>
        </View>
      )}

      {visible.has("chart_projections") && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Projections</Text>
          <View style={[styles.boardChartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ProjectionBarChart data={projectionMonthly} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("section_alerts") && data.alerts.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Alerts ({data.alerts.length})</Text>
          {data.alerts.map(a => (
            <View key={a.id} style={[styles.boardAlertRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.severityDot, { backgroundColor: a.severity === "critical" ? colors.destructive : colors.warning }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertType, { color: colors.mutedForeground }]}>{a.type.replace(/_/g, " ").toUpperCase()}</Text>
                <Text style={[styles.alertMsg, { color: colors.foreground }]}>{a.message}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {visible.has("section_events") && data.events.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Marketing Events</Text>
          {data.events.map(e => (
            <View key={e.id} style={[styles.boardEventRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.eventName, { color: colors.foreground }]}>{e.name}</Text>
                <Text style={[styles.eventMeta, { color: colors.mutedForeground }]}>
                  {e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "TBD"} · {e.status}
                </Text>
              </View>
              {e.estimatedCost != null && <Text style={[styles.eventCost, { color: colors.foreground }]}>{formatCurrency(e.estimatedCost)}</Text>}
            </View>
          ))}
        </View>
      )}

      <View style={[styles.exportSection, { borderTopColor: colors.border }]}>
        <Text style={[styles.exportTitle, { color: colors.foreground }]}>Export Report</Text>
        <View style={styles.exportRow}>
          <TouchableOpacity
            onPress={() => handleExport("pdf", "hubert-board-report.pdf")}
            style={[styles.exportButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="file-text" size={18} color={colors.primaryForeground} />
            <Text style={[styles.exportButtonText, { color: colors.primaryForeground }]}>Download PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleExport("excel", "hubert-fy2026-budget.xlsx")}
            style={[styles.exportButton, { backgroundColor: colors.success }]}
          >
            <Feather name="download" size={18} color={colors.primaryForeground} />
            <Text style={[styles.exportButtonText, { color: colors.primaryForeground }]}>Download Excel</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.footerBrand, { borderTopColor: colors.border }]}>
        <Feather name="trending-up" size={14} color={colors.mutedForeground} />
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Hubert Marketing · Confidential</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14 },
  errorIcon: { marginBottom: 16 },
  errorTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  errorMessage: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  scroll: { flex: 1 },
  content: {},
  header: { alignItems: "center", marginBottom: 28 },
  logoMark: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 14, marginTop: 2 },
  kpiGrid: { gap: 12, marginBottom: 24 },
  kpiBoardCard: { borderRadius: 12, padding: 20, borderWidth: 1 },
  kpiValue: { fontSize: 26, fontWeight: "800" },
  kpiLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginTop: 4 },
  utilBar: { height: 4, borderRadius: 2, marginTop: 10 },
  utilFill: { height: 4, borderRadius: 2 },
  utilText: { fontSize: 11, marginTop: 4 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 10 },
  boardChartCard: { borderRadius: 12, padding: 16, borderWidth: 1 },
  boardAlertRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  severityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  alertType: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  alertMsg: { fontSize: 14, lineHeight: 20, marginTop: 1 },
  boardEventRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1 },
  eventName: { fontSize: 15, fontWeight: "600" },
  eventMeta: { fontSize: 12, marginTop: 2 },
  eventCost: { fontSize: 15, fontWeight: "700" },
  exportSection: { marginTop: 24, paddingTop: 20, borderTopWidth: 1 },
  exportTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  exportRow: { flexDirection: "row", gap: 10 },
  exportButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 10 },
  exportButtonText: { fontSize: 14, fontWeight: "600" },
  footerBrand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 24, borderTopWidth: 1, marginTop: 8 },
  footerText: { fontSize: 12 },
});
