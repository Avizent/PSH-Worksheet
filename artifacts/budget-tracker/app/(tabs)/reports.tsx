import React, { useMemo } from "react";
import { View, ScrollView, StyleSheet, Text, ActivityIndicator } from "react-native";
import Svg, { Path, Text as SvgText, Rect, G, Line, Circle, Polyline } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useGetDashboardCharts, useGetDashboardSummary, useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";

const PIE_COLORS = ["#1e6b4e", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(1) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function PieChart({ data, size, title }: { data: { label: string; value: number }[]; size: number; title: string }) {
  const colors = useColors();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  let currentAngle = 0;
  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArc = angle > 180 ? 1 : 0;
    const pathData = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;

    return { pathData, color: PIE_COLORS[i % PIE_COLORS.length], label: d.label, value: d.value, pct: ((d.value / total) * 100).toFixed(1) };
  });

  return (
    <View style={pieStyles.container}>
      <Text style={[pieStyles.title, { color: colors.foreground }]}>{title}</Text>
      <Svg width={size} height={size}>
        {slices.map((s, i) => (
          <Path key={i} d={s.pathData} fill={s.color} />
        ))}
      </Svg>
      <View style={pieStyles.legend}>
        {slices.map((s, i) => (
          <View key={i} style={pieStyles.legendItem}>
            <View style={[pieStyles.legendDot, { backgroundColor: s.color }]} />
            <Text style={[pieStyles.legendText, { color: colors.foreground }]} numberOfLines={1}>{s.label}</Text>
            <Text style={[pieStyles.legendPct, { color: colors.mutedForeground }]}>{s.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

interface BudgetLine {
  id: number;
  category: string;
  region: string;
  costStatus: string;
  plans?: { month: number; plannedAmount: number }[];
  actuals?: { month: number; actualAmount: number }[];
}

function QuarterlyCompareChart({ data, width, height }: { data: { label: string; planned: number; actual: number }[]; width: number; height: number }) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.flatMap(d => [d.planned, d.actual]), 1);
  const niceMax = Math.ceil(maxVal / 50000) * 50000 || 50000;
  const barGroupWidth = chartW / data.length;
  const barWidth = Math.min(barGroupWidth * 0.35, 30);

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  return (
    <Svg width={width} height={height}>
      {tickVals.map((val, i) => {
        const y = padding.top + chartH - (val / niceMax) * chartH;
        return (
          <G key={i}>
            <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">{formatCurrency(val)}</SvgText>
          </G>
        );
      })}
      {data.map((d, i) => {
        const x = padding.left + i * barGroupWidth + barGroupWidth / 2;
        const plannedH = (d.planned / niceMax) * chartH;
        const actualH = (d.actual / niceMax) * chartH;
        return (
          <G key={i}>
            <Rect x={x - barWidth - 1} y={padding.top + chartH - plannedH} width={barWidth} height={plannedH} fill={colors.primary} rx={3} />
            <Rect x={x + 1} y={padding.top + chartH - actualH} width={barWidth} height={actualH} fill={colors.success} rx={3} />
            <SvgText x={x} y={padding.top + chartH + 20} fontSize={12} fill={colors.mutedForeground} textAnchor="middle">{d.label}</SvgText>
          </G>
        );
      })}
      <Rect x={padding.left + chartW * 0.3} y={height - 14} width={10} height={10} fill={colors.primary} rx={2} />
      <SvgText x={padding.left + chartW * 0.3 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Planned</SvgText>
      <Rect x={padding.left + chartW * 0.6} y={height - 14} width={10} height={10} fill={colors.success} rx={2} />
      <SvgText x={padding.left + chartW * 0.6 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Actual</SvgText>
    </Svg>
  );
}

function MonthlyTrendLine({ data, width, height }: { data: { month: string; actual: number }[]; width: number; height: number }) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map(d => d.actual), 1);
  const niceMax = Math.ceil(maxVal / 10000) * 10000 || 10000;

  const getX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / niceMax) * chartH;

  const validData = data.filter(d => d.actual > 0);
  const points = validData.map((d, i) => `${getX(data.indexOf(d))},${getY(d.actual)}`).join(" ");

  return (
    <Svg width={width} height={height}>
      {Array.from({ length: 5 }, (_, i) => {
        const val = (niceMax / 4) * i;
        const y = getY(val);
        return (
          <G key={i}>
            <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">{formatCurrency(val)}</SvgText>
          </G>
        );
      })}
      {points && <Polyline points={points} fill="none" stroke={colors.primary} strokeWidth={2.5} />}
      {validData.map((d) => {
        const idx = data.indexOf(d);
        return <Circle key={idx} cx={getX(idx)} cy={getY(d.actual)} r={4} fill={colors.primary} />;
      })}
      {data.map((d, i) => (
        <SvgText key={i} x={getX(i)} y={padding.top + chartH + 20} fontSize={10} fill={colors.mutedForeground} textAnchor="middle">{d.month}</SvgText>
      ))}
    </Svg>
  );
}

function ReportsContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";

  const { data: charts, isLoading: chartsLoading } = useGetDashboardCharts({ year: 2026 });
  const { data: budgetLines, isLoading: linesLoading } = useListBudgetLinesWithMonthly({ year: 2026 });
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const pieData = useMemo(() => {
    if (!budgetLines) return { byCategory: [] as { label: string; value: number }[], byRegion: [] as { label: string; value: number }[], byCostType: [] as { label: string; value: number }[] };
    const lines = budgetLines as BudgetLine[];
    const catMap = new Map<string, number>();
    const regMap = new Map<string, number>();
    const typeMap = new Map<string, number>();

    for (const bl of lines) {
      const totalActual = (bl.actuals ?? []).reduce((s, a) => s + a.actualAmount, 0);
      catMap.set(bl.category, (catMap.get(bl.category) ?? 0) + totalActual);
      regMap.set(bl.region || "Global", (regMap.get(bl.region || "Global") ?? 0) + totalActual);
      typeMap.set(bl.costStatus || "Variable", (typeMap.get(bl.costStatus || "Variable") ?? 0) + totalActual);
    }

    const toArr = (m: Map<string, number>) => Array.from(m, ([label, value]) => ({ label, value })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
    return { byCategory: toArr(catMap), byRegion: toArr(regMap), byCostType: toArr(typeMap) };
  }, [budgetLines]);

  const quarterlyData = useMemo(() => {
    if (!charts?.monthly) return [];
    const monthly = charts.monthly as { month: number; planned: number; actual: number }[];
    return [
      { label: "Q1", planned: monthly.slice(0, 3).reduce((s, m) => s + m.planned, 0), actual: monthly.slice(0, 3).reduce((s, m) => s + m.actual, 0) },
      { label: "Q2", planned: monthly.slice(3, 6).reduce((s, m) => s + m.planned, 0), actual: monthly.slice(3, 6).reduce((s, m) => s + m.actual, 0) },
      { label: "Q3", planned: monthly.slice(6, 9).reduce((s, m) => s + m.planned, 0), actual: monthly.slice(6, 9).reduce((s, m) => s + m.actual, 0) },
      { label: "Q4", planned: monthly.slice(9, 12).reduce((s, m) => s + m.planned, 0), actual: monthly.slice(9, 12).reduce((s, m) => s + m.actual, 0) },
    ];
  }, [charts]);

  const monthlyTrend = useMemo(() => {
    if (!charts?.monthly) return [];
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (charts.monthly as { month: number; actual: number }[]).map(m => ({
      month: MONTH_LABELS[m.month - 1],
      actual: m.actual,
    }));
  }, [charts]);

  if (chartsLoading || linesLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const pieSize = isDesktop ? 200 : 180;

  const content = (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}>
      <SectionHeader title="Reports" subtitle={`Visual analytics and spend distribution \u00b7 2026`} />

      <View style={[styles.pieRow, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <PieChart data={pieData.byCategory} size={pieSize} title="Spend by Category" />
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <PieChart data={pieData.byRegion} size={pieSize} title="Spend by Region" />
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <PieChart data={pieData.byCostType} size={pieSize} title="Spend by Cost Type" />
        </View>
      </View>

      <View style={[styles.twoCol, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Planned vs Actual by Quarter</Text>
          <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
            <QuarterlyCompareChart data={quarterlyData} width={isDesktop ? 460 : 360} height={260} />
          </ScrollView>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Monthly Spend Trend</Text>
          <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
            <MonthlyTrendLine data={monthlyTrend} width={isDesktop ? 460 : 400} height={260} />
          </ScrollView>
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

export default function ReportsScreen() {
  return <ReportsContent />;
}

const pieStyles = StyleSheet.create({
  container: { alignItems: "center" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 12, textAlign: "center" },
  legend: { marginTop: 12, width: "100%" },
  legendItem: { flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  legendPct: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  pieRow: { gap: 16, marginBottom: 20 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
});
