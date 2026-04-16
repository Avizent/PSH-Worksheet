import React, { useState, useMemo } from "react";
import { View, ScrollView, StyleSheet, Text, Platform, ActivityIndicator, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { KpiCard } from "@/components/KpiCard";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";

const QUARTERS = [
  { label: "Q1", months: [1, 2, 3] },
  { label: "Q2", months: [4, 5, 6] },
  { label: "Q3", months: [7, 8, 9] },
  { label: "Q4", months: [10, 11, 12] },
];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(1) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

interface BudgetLine {
  id: number;
  category: string;
  lineItem: string;
  region: string;
  plans?: { month: number; plannedAmount: number }[];
  actuals?: { month: number; actualAmount: number }[];
}

function HorizontalBarChart({ data, width }: { data: { label: string; planned: number; actual: number }[]; width: number }) {
  const colors = useColors();
  const barHeight = 28;
  const labelWidth = 140;
  const chartWidth = width - labelWidth - 20;
  const rowHeight = barHeight + 16;
  const height = data.length * rowHeight + 40;
  const maxVal = Math.max(...data.flatMap(d => [d.planned, d.actual]), 1);

  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const y = i * rowHeight + 10;
        const plannedW = (d.planned / maxVal) * chartWidth;
        const actualW = (d.actual / maxVal) * chartWidth;
        return (
          <G key={i}>
            <SvgText x={0} y={y + barHeight / 2 + 4} fontSize={11} fill={colors.foreground}>{d.label.length > 18 ? d.label.slice(0, 18) + "..." : d.label}</SvgText>
            <Rect x={labelWidth} y={y} width={Math.max(plannedW, 2)} height={barHeight / 2 - 1} fill={colors.primary} rx={3} />
            <Rect x={labelWidth} y={y + barHeight / 2 + 1} width={Math.max(actualW, 1)} height={barHeight / 2 - 1} fill={colors.success} rx={3} />
          </G>
        );
      })}
      <G>
        <Rect x={labelWidth + chartWidth * 0.3} y={height - 20} width={10} height={10} fill={colors.primary} rx={2} />
        <SvgText x={labelWidth + chartWidth * 0.3 + 14} y={height - 11} fontSize={10} fill={colors.mutedForeground}>Planned</SvgText>
        <Rect x={labelWidth + chartWidth * 0.6} y={height - 20} width={10} height={10} fill={colors.success} rx={2} />
        <SvgText x={labelWidth + chartWidth * 0.6 + 14} y={height - 11} fontSize={10} fill={colors.mutedForeground}>Actual</SvgText>
      </G>
    </Svg>
  );
}

function QuarterlyContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const [selectedQ, setSelectedQ] = useState(Math.floor(new Date().getMonth() / 3));

  const { data: budgetLines, isLoading } = useListBudgetLinesWithMonthly({ year: 2026 });
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const quarter = QUARTERS[selectedQ];

  const stats = useMemo(() => {
    if (!budgetLines) return { planned: 0, actual: 0, remaining: 0, byCategory: [] as { label: string; planned: number; actual: number }[], byRegion: [] as { region: string; planned: number; actual: number; remaining: number }[] };
    const lines = budgetLines as BudgetLine[];
    let totalPlanned = 0, totalActual = 0;
    const catMap = new Map<string, { planned: number; actual: number }>();
    const regMap = new Map<string, { planned: number; actual: number }>();

    for (const bl of lines) {
      let linePlanned = 0, lineActual = 0;
      for (const m of quarter.months) {
        linePlanned += bl.plans?.find(p => p.month === m)?.plannedAmount ?? 0;
        lineActual += bl.actuals?.find(a => a.month === m)?.actualAmount ?? 0;
      }
      totalPlanned += linePlanned;
      totalActual += lineActual;

      const cat = catMap.get(bl.category) ?? { planned: 0, actual: 0 };
      cat.planned += linePlanned;
      cat.actual += lineActual;
      catMap.set(bl.category, cat);

      const reg = regMap.get(bl.region || "Global") ?? { planned: 0, actual: 0 };
      reg.planned += linePlanned;
      reg.actual += lineActual;
      regMap.set(bl.region || "Global", reg);
    }

    return {
      planned: totalPlanned,
      actual: totalActual,
      remaining: totalPlanned - totalActual,
      byCategory: Array.from(catMap, ([label, v]) => ({ label, ...v })).sort((a, b) => b.planned - a.planned),
      byRegion: Array.from(regMap, ([region, v]) => ({ region, ...v, remaining: v.planned - v.actual })).sort((a, b) => b.planned - a.planned),
    };
  }, [budgetLines, selectedQ]);

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const content = (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}>
      <View style={styles.headerRow}>
        <SectionHeader title="Quarterly View" subtitle={`Budget breakdown by quarter`} />
        <View style={styles.quarterPicker}>
          {QUARTERS.map((q, i) => (
            <TouchableOpacity key={q.label} onPress={() => setSelectedQ(i)} style={[styles.quarterChip, { backgroundColor: i === selectedQ ? colors.primary : colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: i === selectedQ ? "#fff" : colors.foreground }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[styles.kpiRow, { flexDirection: isDesktop ? "row" : "column" }]}>
        <KpiCard title={`${quarter.label} PLANNED`} value={formatCurrency(stats.planned)} icon="target" color={colors.primary} />
        <KpiCard title={`${quarter.label} SPENT`} value={formatCurrency(stats.actual)} icon="credit-card" color={colors.success} />
        <KpiCard title={`${quarter.label} REMAINING`} value={formatCurrency(stats.remaining)} icon="shield" color={stats.remaining >= 0 ? colors.success : colors.destructive} />
      </View>

      <View style={[styles.twoCol, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Category Consumption</Text>
          <HorizontalBarChart data={stats.byCategory} width={isDesktop ? 480 : 340} />
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Region Breakdown</Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1 }]}>Region</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 90, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 90, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 90, textAlign: "right" }]}>Remaining</Text>
          </View>
          {stats.byRegion.map((r) => (
            <View key={r.region} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1 }]}>{r.region}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 90, textAlign: "right" }]}>{formatCurrency(r.planned)}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 90, textAlign: "right" }]}>{formatCurrency(r.actual)}</Text>
              <Text style={[styles.tdText, { color: r.remaining >= 0 ? colors.success : colors.destructive, width: 90, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(r.remaining)}</Text>
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

export default function QuarterlyScreen() {
  return <QuarterlyContent />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  quarterPicker: { flexDirection: "row", gap: 6 },
  quarterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  kpiRow: { gap: 12, marginBottom: 24 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  tableHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1 },
  thText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1 },
  tdText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
