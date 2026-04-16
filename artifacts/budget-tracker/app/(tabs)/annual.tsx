import React, { useMemo } from "react";
import { View, ScrollView, StyleSheet, Text, ActivityIndicator } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { KpiCard } from "@/components/KpiCard";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useGetDashboardSummary, useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(1) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

interface BudgetLine {
  id: number;
  category: string;
  region: string;
  plans?: { month: number; plannedAmount: number }[];
  actuals?: { month: number; actualAmount: number }[];
}

function QuarterlyBarChart({ data, width, height }: { data: { label: string; planned: number; actual: number }[]; width: number; height: number }) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.flatMap(d => [d.planned, d.actual]), 1);
  const niceMax = Math.ceil(maxVal / 10000) * 10000 || 10000;
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

function AnnualContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ year: 2026 });
  const { data: budgetLines, isLoading: linesLoading } = useListBudgetLinesWithMonthly({ year: 2026 });
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const stats = useMemo(() => {
    if (!budgetLines) return { byCategory: [] as { category: string; planned: number; actual: number; remaining: number; varPct: number }[], byRegion: [] as { region: string; planned: number; actual: number; remaining: number }[], quarterly: [] as { label: string; planned: number; actual: number }[] };
    const lines = budgetLines as BudgetLine[];
    const catMap = new Map<string, { planned: number; actual: number }>();
    const regMap = new Map<string, { planned: number; actual: number }>();
    const qData = [0, 0, 0, 0].map(() => ({ planned: 0, actual: 0 }));

    for (const bl of lines) {
      let catPlanned = 0, catActual = 0;
      for (const p of bl.plans ?? []) {
        catPlanned += p.plannedAmount;
        const qi = Math.floor((p.month - 1) / 3);
        qData[qi].planned += p.plannedAmount;
      }
      for (const a of bl.actuals ?? []) {
        catActual += a.actualAmount;
        const qi = Math.floor((a.month - 1) / 3);
        qData[qi].actual += a.actualAmount;
      }

      const cat = catMap.get(bl.category) ?? { planned: 0, actual: 0 };
      cat.planned += catPlanned;
      cat.actual += catActual;
      catMap.set(bl.category, cat);

      const reg = regMap.get(bl.region || "Global") ?? { planned: 0, actual: 0 };
      reg.planned += catPlanned;
      reg.actual += catActual;
      regMap.set(bl.region || "Global", reg);
    }

    return {
      byCategory: Array.from(catMap, ([category, v]) => ({
        category,
        ...v,
        remaining: v.planned - v.actual,
        varPct: v.planned > 0 ? ((v.planned - v.actual) / v.planned) * 100 : 0,
      })).sort((a, b) => b.planned - a.planned),
      byRegion: Array.from(regMap, ([region, v]) => ({
        region,
        ...v,
        remaining: v.planned - v.actual,
      })).sort((a, b) => b.planned - a.planned),
      quarterly: qData.map((q, i) => ({ label: `Q${i + 1}`, ...q })),
    };
  }, [budgetLines]);

  if (summaryLoading || linesLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const totalPlanned = summary?.totalBudget ?? 0;
  const totalActual = summary?.spentYtd ?? 0;
  const totalRemaining = summary?.remaining ?? 0;

  const content = (
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}>
      <SectionHeader title="Annual View" subtitle={`Full-year budget summary \u00b7 2026`} />

      <View style={[styles.kpiRow, { flexDirection: isDesktop ? "row" : "column" }]}>
        <KpiCard title="TOTAL PLANNED" value={formatCurrency(totalPlanned)} icon="target" color={colors.primary} />
        <KpiCard title="TOTAL ACTUAL" value={formatCurrency(totalActual)} icon="credit-card" color={colors.success} />
        <KpiCard title="TOTAL REMAINING" value={formatCurrency(totalRemaining)} icon="shield" color={totalRemaining >= 0 ? colors.success : colors.destructive} />
      </View>

      <View style={[styles.twoCol, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1.2 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>By Category</Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1 }]}>Category</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Remaining</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>Var %</Text>
          </View>
          {stats.byCategory.map((c) => (
            <View key={c.category} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{c.category}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 80, textAlign: "right" }]}>{formatCurrency(c.planned)}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 80, textAlign: "right" }]}>{formatCurrency(c.actual)}</Text>
              <Text style={[styles.tdText, { color: c.remaining >= 0 ? colors.success : colors.destructive, width: 80, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(c.remaining)}</Text>
              <Text style={[styles.tdText, { color: colors.mutedForeground, width: 55, textAlign: "right" }]}>{c.varPct.toFixed(1)}%</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>By Region</Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.mutedForeground, flex: 1 }]}>Region</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Planned</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Actual</Text>
            <Text style={[styles.thText, { color: colors.mutedForeground, width: 80, textAlign: "right" }]}>Remaining</Text>
          </View>
          {stats.byRegion.map((r) => (
            <View key={r.region} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdText, { color: colors.foreground, flex: 1 }]}>{r.region}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 80, textAlign: "right" }]}>{formatCurrency(r.planned)}</Text>
              <Text style={[styles.tdText, { color: colors.foreground, width: 80, textAlign: "right" }]}>{formatCurrency(r.actual)}</Text>
              <Text style={[styles.tdText, { color: r.remaining >= 0 ? colors.success : colors.destructive, width: 80, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>{formatCurrency(r.remaining)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Planned vs Actual by Quarter</Text>
        <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
          <QuarterlyBarChart data={stats.quarterly} width={isDesktop ? 600 : 400} height={280} />
        </ScrollView>
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

export default function AnnualScreen() {
  return <AnnualContent />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  kpiRow: { gap: 12, marginBottom: 24 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  tableHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1 },
  thText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1 },
  tdText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
