import React, { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G, Circle, Polyline } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useGetDashboardCharts, useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";
import { useCurrency } from "@/contexts/CurrencyContext";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function varPct(actual: number, planned: number): string {
  if (planned === 0) return "-";
  const p = ((actual - planned) / planned) * 100;
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}

interface BudgetLine {
  id: number;
  lineItem: string;
  category: string;
  owner?: string | null;
  plans?: { month: number; plannedAmount: number }[];
  actuals?: { month: number; actualAmount: number }[];
}

type DrillLine = { id: number; lineItem: string; owner: string | null; category: string; planned: number; actual: number };

function SpendTrendChart({ data, width, height }: { data: { month: string; planned: number; actual: number }[]; width: number; height: number }) {
  const { format: formatCurrency } = useCurrency();
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

function MonthDrillRows({ lines }: { lines: DrillLine[] }) {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  return (
    <View style={[drillStyles.block, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      <View style={[drillStyles.header, { borderBottomColor: colors.border }]}>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, flex: 1, paddingLeft: 20 }]}>Line Item</Text>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, width: 100 }]}>Category</Text>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, width: 80 }]}>Owner</Text>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Planned</Text>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Actual</Text>
        <Text style={[drillStyles.th, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>Var %</Text>
      </View>
      {lines.sort((a, b) => b.planned - a.planned).map((line) => {
        const variance = line.actual - line.planned;
        const isOver = variance > 0;
        const varColor = isOver ? "#ef4444" : variance < 0 ? "#16a34a" : colors.mutedForeground;
        return (
          <View key={line.id} style={[drillStyles.row, { borderBottomColor: colors.border }]}>
            <Text style={[drillStyles.td, { color: colors.foreground, flex: 1, paddingLeft: 20 }]} numberOfLines={2}>{line.lineItem}</Text>
            <Text style={[drillStyles.td, { color: colors.mutedForeground, width: 100 }]} numberOfLines={1}>{line.category}</Text>
            <Text style={[drillStyles.td, { color: colors.mutedForeground, width: 80 }]} numberOfLines={1}>{line.owner ?? "—"}</Text>
            <Text style={[drillStyles.td, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>{formatCurrency(line.planned)}</Text>
            <Text style={[drillStyles.td, { color: colors.foreground, width: 80, textAlign: "right" }]}>{formatCurrency(line.actual)}</Text>
            <Text style={[drillStyles.td, { color: varColor, width: 55, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{varPct(line.actual, line.planned)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function MonthlyContent() {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const { data: charts, isLoading: chartsLoading } = useGetDashboardCharts({ year: 2026 });
  const { data: budgetLines } = useListBudgetLinesWithMonthly({ year: 2026 });
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
      monthNum: m.month,
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
      return { label: q.label, planned, actual, variance: planned - actual, varPct: planned > 0 ? ((planned - actual) / planned) * 100 : 0 };
    });
  }, [monthlyTable]);

  const linesByMonth = useMemo(() => {
    if (!budgetLines) return new Map<string, DrillLine[]>();
    const lines = budgetLines as BudgetLine[];
    const map = new Map<string, DrillLine[]>();
    for (const bl of lines) {
      for (let m = 1; m <= 12; m++) {
        const planned = bl.plans?.find(p => p.month === m)?.plannedAmount ?? 0;
        const actual = bl.actuals?.find(a => a.month === m)?.actualAmount ?? 0;
        if (planned === 0 && actual === 0) continue;
        const label = MONTH_LABELS[m - 1];
        const existing = map.get(label) ?? [];
        existing.push({ id: bl.id, lineItem: bl.lineItem, owner: bl.owner ?? null, category: bl.category, planned, actual });
        map.set(label, existing);
      }
    }
    return map;
  }, [budgetLines]);

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
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Month-by-Month Breakdown
            {isDesktop && <Text style={[styles.cardHint, { color: colors.mutedForeground }]}> · tap a row to expand</Text>}
          </Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            {isDesktop && <View style={{ width: 20 }} />}
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 50 }]}>Month</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>Variance</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>Var %</Text>
          </View>
          {monthlyTable.map((r) => {
            const isOpen = expandedMonth === r.month;
            const childLines = linesByMonth.get(r.month) ?? [];
            const rowContent = (
              <>
                <View style={[styles.tableRow, { borderBottomColor: isOpen ? "transparent" : colors.border }]}>
                  {isDesktop && <View style={{ width: 20, justifyContent: "center" }}><Feather name={isOpen ? "chevron-down" : "chevron-right"} size={13} color={colors.mutedForeground} /></View>}
                  <Text style={[styles.tdText, { color: colors.foreground, width: 50, fontFamily: "Inter_600SemiBold" }]}>{r.month}</Text>
                  <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(r.planned)}</Text>
                  <Text style={[styles.tdText, { color: colors.foreground, flex: 1, textAlign: "right" }]}>{formatCurrency(r.actual)}</Text>
                  <Text style={[styles.tdText, { color: r.variance >= 0 ? colors.success : colors.destructive, flex: 1, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(r.variance)}</Text>
                  <Text style={[styles.tdText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>{r.varPct.toFixed(1)}%</Text>
                </View>
                {isOpen && childLines.length > 0 && <MonthDrillRows lines={childLines} />}
              </>
            );
            if (isDesktop) {
              return <TouchableOpacity key={r.month} onPress={() => setExpandedMonth(isOpen ? null : r.month)} activeOpacity={0.7}>{rowContent}</TouchableOpacity>;
            }
            return <View key={r.month}>{rowContent}</View>;
          })}
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

const drillStyles = StyleSheet.create({
  block: { borderBottomWidth: 1, paddingBottom: 4 },
  header: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 1, alignItems: "center" },
  row: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  th: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  td: { fontSize: 12, fontFamily: "Inter_400Regular" },
});

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  cardHint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tableHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, alignItems: "center" },
  thText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, alignItems: "center" },
  tdText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
