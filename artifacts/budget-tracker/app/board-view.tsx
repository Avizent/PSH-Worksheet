import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
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
      <View style={[styles.center, { backgroundColor: "#f8fafc", paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#1e3a5f" />
        <Text style={[styles.loadingText, { color: "#6b7280" }]}>Loading board view...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.center, { backgroundColor: "#f8fafc", paddingTop: insets.top }]}>
        <View style={styles.errorIcon}>
          <Feather name="lock" size={40} color="#dc2626" />
        </View>
        <Text style={styles.errorTitle}>Access Denied</Text>
        <Text style={styles.errorMessage}>{error || "Unable to load the board view"}</Text>
      </View>
    );
  }

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
      style={[styles.scroll, { backgroundColor: "#f8fafc" }]}
      contentContainerStyle={[styles.content, {
        paddingTop: insets.top + 24,
        paddingHorizontal: isWide ? 48 : 20,
        paddingBottom: insets.bottom + 40,
      }]}
    >
      <View style={styles.header}>
        <View style={[styles.logoMark, { backgroundColor: "#1e3a5f" }]}>
          <Feather name="trending-up" size={20} color="#fff" />
        </View>
        <Text style={styles.title}>Hubert Marketing Budget</Text>
        <Text style={styles.subtitle}>FY2026 Board Report</Text>
      </View>

      {(visible.has("kpi_total_budget") || visible.has("kpi_spent_ytd") || visible.has("kpi_remaining") || visible.has("kpi_fixed_run_rate")) && (
        <View style={[styles.kpiGrid, { flexDirection: isWide ? "row" : "column" }]}>
          {visible.has("kpi_total_budget") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined }]}>
              <Text style={styles.kpiValue}>{formatCurrency(s.totalBudget)}</Text>
              <Text style={styles.kpiLabel}>TOTAL BUDGET</Text>
            </View>
          )}
          {visible.has("kpi_spent_ytd") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined }]}>
              <Text style={styles.kpiValue}>{formatCurrency(s.spentYtd)}</Text>
              <Text style={styles.kpiLabel}>SPENT YTD</Text>
              <View style={styles.utilBar}>
                <View style={[styles.utilFill, { width: `${Math.min(s.budgetUtilisation, 100)}%` }]} />
              </View>
              <Text style={styles.utilText}>{s.budgetUtilisation.toFixed(1)}% utilised</Text>
            </View>
          )}
          {visible.has("kpi_remaining") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined }]}>
              <Text style={[styles.kpiValue, { color: s.remaining > 0 ? "#16a34a" : "#dc2626" }]}>{formatCurrency(s.remaining)}</Text>
              <Text style={styles.kpiLabel}>REMAINING</Text>
            </View>
          )}
          {visible.has("kpi_fixed_run_rate") && (
            <View style={[styles.kpiBoardCard, { flex: isWide ? 1 : undefined }]}>
              <Text style={styles.kpiValue}>{formatCurrency(s.fixedRunRate)}</Text>
              <Text style={styles.kpiLabel}>FIXED RUN RATE /MONTH</Text>
            </View>
          )}
        </View>
      )}

      {visible.has("chart_plan_vs_actual") && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plan vs Actual (Monthly)</Text>
          <View style={styles.boardChartCard}>
            <BarChart data={chartMonthly} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("chart_cumulative") && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cumulative Spend vs Plan</Text>
          <View style={styles.boardChartCard}>
            <LineChart data={chartCumulative} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("chart_categories") && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category Breakdown</Text>
          <View style={[styles.boardChartCard, { alignItems: "center" }]}>
            <DonutChart data={chartCategories} size={240} />
          </View>
        </View>
      )}

      {visible.has("chart_projections") && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Projections</Text>
          <View style={styles.boardChartCard}>
            <ProjectionBarChart data={projectionMonthly} width={chartWidth} height={280} />
          </View>
        </View>
      )}

      {visible.has("section_alerts") && data.alerts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Alerts ({data.alerts.length})</Text>
          {data.alerts.map(a => (
            <View key={a.id} style={styles.boardAlertRow}>
              <View style={[styles.severityDot, { backgroundColor: a.severity === "critical" ? "#dc2626" : "#d97706" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.alertType}>{a.type.replace(/_/g, " ").toUpperCase()}</Text>
                <Text style={styles.alertMsg}>{a.message}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {visible.has("section_events") && data.events.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Marketing Events</Text>
          {data.events.map(e => (
            <View key={e.id} style={styles.boardEventRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventName}>{e.name}</Text>
                <Text style={styles.eventMeta}>
                  {e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "TBD"} · {e.status}
                </Text>
              </View>
              {e.estimatedCost != null && <Text style={styles.eventCost}>{formatCurrency(e.estimatedCost)}</Text>}
            </View>
          ))}
        </View>
      )}

      <View style={styles.footerBrand}>
        <Feather name="trending-up" size={14} color="#9ca3af" />
        <Text style={styles.footerText}>Hubert Marketing · Confidential</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14 },
  errorIcon: { marginBottom: 16 },
  errorTitle: { fontSize: 22, fontWeight: "700", color: "#1a1a2e", marginBottom: 8 },
  errorMessage: { fontSize: 14, color: "#6b7280", textAlign: "center", maxWidth: 280 },
  scroll: { flex: 1 },
  content: {},
  header: { alignItems: "center", marginBottom: 28 },
  logoMark: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "800", color: "#1a1a2e", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 2 },
  kpiGrid: { gap: 12, marginBottom: 24 },
  kpiBoardCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20, borderWidth: 1, borderColor: "#e5e7eb" },
  kpiValue: { fontSize: 26, fontWeight: "800", color: "#1a1a2e" },
  kpiLabel: { fontSize: 11, fontWeight: "600", color: "#6b7280", letterSpacing: 0.5, marginTop: 4 },
  utilBar: { height: 4, backgroundColor: "#e5e7eb", borderRadius: 2, marginTop: 10 },
  utilFill: { height: 4, backgroundColor: "#1e3a5f", borderRadius: 2 },
  utilText: { fontSize: 11, color: "#6b7280", marginTop: 4 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#1a1a2e", marginBottom: 10 },
  boardChartCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#e5e7eb" },
  boardAlertRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  severityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  alertType: { fontSize: 11, fontWeight: "700", color: "#6b7280", letterSpacing: 0.3 },
  alertMsg: { fontSize: 14, color: "#1a1a2e", lineHeight: 20, marginTop: 1 },
  boardEventRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  eventName: { fontSize: 15, fontWeight: "600", color: "#1a1a2e" },
  eventMeta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  eventCost: { fontSize: 15, fontWeight: "700", color: "#1a1a2e" },
  footerBrand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 24, borderTopWidth: 1, borderTopColor: "#e5e7eb", marginTop: 8 },
  footerText: { fontSize: 12, color: "#9ca3af" },
});
