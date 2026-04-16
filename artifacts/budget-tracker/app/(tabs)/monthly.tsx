import React, { useMemo } from "react";
import { View, ScrollView, StyleSheet, Text, ActivityIndicator } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G, Circle, Polyline } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useGetDashboardCharts, useListAlerts } from "@workspace/api-client-react";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(1) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function SpendTrendChart({ data, width, height }: { data: { month: string; planned: number; actual: number }[]; width: number; height: number }) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.flatMap(d => [d.planned, d.actual]), 1);
  const niceMax = Math.ceil(maxVal / 10000) * 10000 || 10000;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  const getX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / niceMax) * chartH;

  const plannedPoints = data.map((d, i) => `${getX(i)},${getY(d.planned)}`).join(" ");
  const actualPoints = data
    .map((d, i) => d.actual > 0 ? `${getX(i)},${getY(d.actual)}` : null)
    .filter(Boolean)
    .join(" ");

  return (
    <Svg width={width} height={height}>
      {tickVals.map((val, i) => {
        const y = getY(val);
        return (
          <G key={i}>
            <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">{formatCurrency(val)}</SvgText>
          </G>
        );
      })}
      <Polyline points={plannedPoints} fill="none" stroke={colors.primary} strokeWidth={2} />
      {actualPoints && <Polyline points={actualPoints} fill="none" stroke={colors.success} strokeWidth={2} />}
      {data.map((d, i) => (
        <G key={i}>
          <Circle cx={getX(i)} cy={getY(d.planned)} r={3} fill={colors.primary} />
          {d.actual > 0 && <Circle cx={getX(i)} cy={getY(d.actual)} r={3} fill={colors.success} />}
          <SvgText x={getX(i)} y={padding.top + chartH + 20} fontSize={10} fill={colors.mutedForeground} textAnchor="middle">{d.month}</SvgText>
        </G>
      ))}
      <Rect x={padding.left + chartW * 0.25} y={height - 14} width={10} height={10} fill={colors.primary} rx={2} />
      <SvgText x={padding.left + chartW * 0.25 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Planned</SvgText>
      <Rect x={padding.left + chartW * 0.55} y={height - 14} width={10} height={10} fill={colors.success} rx={2} />
      <SvgText x={padding.left + chartW * 0.55 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Actual</SvgText>
    </Svg>
  );
}

function MonthlyContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";

  const { data: charts, isLoading: chartsLoading } = useGetDashboardCharts({ year: 2026 });
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const monthlyData = useMemo(() => {
    if (!charts?.monthly) return [];
    return (charts.monthly as { month: number; monthLabel: string; planned: number; actual: number }[]).map(m => ({
      month: m.monthLabel,
      planned: m.planned,
      actual: m.actual,
    }));
  }, [charts]);

  const monthlyTable = useMemo(() => {
    if (!charts?.monthly) return [];
    return (charts.monthly as { month: number; monthLabel: string; planned: number; actual: number; cumPlanned: number; cumActual: number }[]).map(m => ({
      month: m.monthLabel,
      planned: m.planned,
      actual: m.actual,
      variance: m.planned - m.actual,
      varPct: m.planned > 0 ? ((m.planned - m.actual) / m.planned) * 100 : 0,
      cumPlanned: m.cumPlanned,
      cumActual: m.cumActual,
    }));
  }, [charts]);

  const quarterlyRollup = useMemo(() => {
    if (!monthlyTable.length) return [];
    const quarters = [
      { label: "Q1", months: monthlyTable.slice(0, 3) },
      { label: "Q2", months: monthlyTable.slice(3, 6) },
      { label: "Q3", months: monthlyTable.slice(6, 9) },
      { label: "Q4", months: monthlyTable.slice(9, 12) },
    ];
    return quarters.map(q => {
      const planned = q.months.reduce((s, m) => s + m.planned, 0);
      const actual = q.months.reduce((s, m) => s + m.actual, 0);
      return {
        label: q.label,
        planned,
        actual,
        variance: planned - actual,
        varPct: planned > 0 ? ((planned - actual) / planned) * 100 : 0,
      };
    });
  }, [monthlyTable]);

  if (chartsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const content = (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}>
      <SectionHeader title="Monthly View" subtitle={`Month-by-month spend analysis \u00b7 2026`} />

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Monthly Spend Trend</Text>
        <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
          <SpendTrendChart data={monthlyData} width={isDesktop ? 700 : 500} height={280} />
        </ScrollView>
      </View>

      <View style={[styles.twoCol, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1.2 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Month-by-Month Breakdown</Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 50 }]}>Month</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Variance</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>Var %</Text>
          </View>
          {monthlyTable.map((r) => (
            <View key={r.month} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdText, { color: colors.foreground, width: 50, fontFamily: "Inter_600SemiBold" }]}>{r.month}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(r.planned)}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(r.actual)}</Text>
              <Text style={[styles.tdText, { color: r.variance >= 0 ? colors.success : colors.destructive, flex: 1, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(r.variance)}</Text>
              <Text style={[styles.tdText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>{r.varPct.toFixed(1)}%</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 0.8 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Quarterly Roll-Up</Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 40 }]}>Qtr</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Variance</Text>
          </View>
          {quarterlyRollup.map((q) => (
            <View key={q.label} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdText, { color: colors.foreground, width: 40, fontFamily: "Inter_700Bold" }]}>{q.label}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(q.planned)}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(q.actual)}</Text>
              <Text style={[styles.tdText, { color: q.variance >= 0 ? colors.success : colors.destructive, flex: 1, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(q.variance)}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={alertCount} />
        <View style={{ flex: 1 }}>{content}</View>
      </View>
    );
  }
  return content;
}

export default function MonthlyScreen() {
  return <MonthlyContent />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  tableHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1 },
  thText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1 },
  tdText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
