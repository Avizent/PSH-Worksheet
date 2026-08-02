import React, { useMemo, useState, useEffect, useCallback } from "react";
import { View, ScrollView, StyleSheet, Text, ActivityIndicator, useWindowDimensions, Platform, Alert, TouchableOpacity } from "react-native";
import Svg, { Path, Text as SvgText, Rect, G, Line, Circle, Polyline } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { Pressable } from "react-native";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { useGetDashboardCharts, useGetDashboardSummary, useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";
import { getApiUrl } from "@/utils/getApiUrl";
import { CHANNEL_VALUES, CHANNEL_LABELS, type ChannelValue } from "@/components/BudgetTable";
import { getSessionToken } from "@/lib/authSession";
import { apiFetch } from "@/lib/apiFetch";
import { Feather } from "@expo/vector-icons";
import { useCurrency } from "@/contexts/CurrencyContext";

type ChannelFilter = "all" | "none" | ChannelValue;

const PIE_COLORS = ["#1e6b4e", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
const BURNDOWN_COLORS = ["#1e6b4e", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6"];

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
  channel?: string | null;
  plans?: { month: number; plannedAmount: number }[];
  actuals?: { month: number; actualAmount: number }[];
}

function QuarterlyCompareChart({ data, width, height }: { data: { label: string; planned: number; actual: number }[]; width: number; height: number }) {
  const { format: formatCurrency } = useCurrency();
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
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map(d => d.actual), 1);
  const niceMax = Math.ceil(maxVal / 10000) * 10000 || 10000;

  const getX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / niceMax) * chartH;

  const validData = data.filter(d => d.actual > 0);
  const points = validData.map((d) => `${getX(data.indexOf(d))},${getY(d.actual)}`).join(" ");

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

function FixedVsVariableChart({ data, width, height }: { data: { label: string; fixedActual: number; variableActual: number }[]; width: number; height: number }) {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map(d => d.fixedActual + d.variableActual), 1);
  const niceMax = Math.ceil(maxVal / 50000) * 50000 || 50000;
  const barW = chartW / data.length - 4;

  return (
    <Svg width={width} height={height}>
      {Array.from({ length: 5 }, (_, i) => {
        const val = (niceMax / 4) * i;
        const y = padding.top + chartH - (val / niceMax) * chartH;
        return (
          <G key={i}>
            <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">{formatCurrency(val)}</SvgText>
          </G>
        );
      })}
      {data.map((d, i) => {
        const x = padding.left + i * (barW + 4) + 2;
        const fixH = (d.fixedActual / niceMax) * chartH;
        const varH = (d.variableActual / niceMax) * chartH;
        return (
          <G key={i}>
            <Rect x={x} y={padding.top + chartH - fixH} width={barW} height={fixH} fill="#2563eb" rx={2} />
            <Rect x={x} y={padding.top + chartH - fixH - varH} width={barW} height={varH} fill="#f59e0b" rx={2} />
            <SvgText x={x + barW / 2} y={padding.top + chartH + 18} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{d.label}</SvgText>
          </G>
        );
      })}
      <Rect x={padding.left + chartW * 0.2} y={height - 14} width={10} height={10} fill="#2563eb" rx={2} />
      <SvgText x={padding.left + chartW * 0.2 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Fixed</SvgText>
      <Rect x={padding.left + chartW * 0.5} y={height - 14} width={10} height={10} fill="#f59e0b" rx={2} />
      <SvgText x={padding.left + chartW * 0.5 + 14} y={height - 5} fontSize={10} fill={colors.mutedForeground}>Variable</SvgText>
    </Svg>
  );
}

function CategoryBurndownChart({ data, categories, width, height }: { data: Record<string, unknown>[]; categories: string[]; width: number; height: number }) {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allVals = data.flatMap(d => categories.map(c => Number(d[c] ?? 0)));
  const maxVal = Math.max(...allVals, 1);
  const niceMax = Math.ceil(maxVal / 100000) * 100000 || 100000;

  const getX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / niceMax) * chartH;

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
      {categories.map((cat, ci) => {
        const color = BURNDOWN_COLORS[ci % BURNDOWN_COLORS.length];
        const points = data.map((d, i) => `${getX(i)},${getY(Number(d[cat] ?? 0))}`).join(" ");
        return (
          <G key={cat}>
            <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />
            {data.map((d, i) => (
              <Circle key={i} cx={getX(i)} cy={getY(Number(d[cat] ?? 0))} r={3} fill={color} />
            ))}
          </G>
        );
      })}
      {data.map((d, i) => (
        <SvgText key={i} x={getX(i)} y={padding.top + chartH + 18} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{String(d.label)}</SvgText>
      ))}
    </Svg>
  );
}

const REGION_COLORS: Record<string, { planned: string; actual: string }> = {
  CEE: { planned: "#2563eb", actual: "#60a5fa" },
  DACH: { planned: "#16a34a", actual: "#4ade80" },
  EU: { planned: "#d97706", actual: "#fbbf24" },
  Global: { planned: "#7c3aed", actual: "#a78bfa" },
  UK: { planned: "#dc2626", actual: "#f87171" },
};

function RegionalInvestmentChart({ data, regions, width, height }: { data: { quarter: string; [key: string]: unknown }[]; regions: string[]; width: number; height: number }) {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 55, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  let maxVal = 0;
  for (const d of data) {
    for (const r of regions) {
      maxVal = Math.max(maxVal, Number(d[`${r}_planned`] ?? 0), Number(d[`${r}_actual`] ?? 0));
    }
  }
  const niceMax = Math.ceil(maxVal / 50000) * 50000 || 50000;

  const quarterW = chartW / data.length;
  const regionW = quarterW / (regions.length + 1);
  const barW = Math.min(regionW * 0.4, 14);

  return (
    <Svg width={width} height={height}>
      {Array.from({ length: 5 }, (_, i) => {
        const val = (niceMax / 4) * i;
        const y = padding.top + chartH - (val / niceMax) * chartH;
        return (
          <G key={i}>
            <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
            <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">{formatCurrency(val)}</SvgText>
          </G>
        );
      })}
      {data.map((d, qi) => {
        const qx = padding.left + qi * quarterW;
        return (
          <G key={qi}>
            {regions.map((r, ri) => {
              const cx = qx + (ri + 1) * regionW;
              const planned = Number(d[`${r}_planned`] ?? 0);
              const actual = Number(d[`${r}_actual`] ?? 0);
              const pColor = REGION_COLORS[r]?.planned ?? "#6b7280";
              const aColor = REGION_COLORS[r]?.actual ?? "#9ca3af";
              const pH = (planned / niceMax) * chartH;
              const aH = (actual / niceMax) * chartH;
              return (
                <G key={r}>
                  <Rect x={cx - barW - 1} y={padding.top + chartH - pH} width={barW} height={pH} fill={pColor} rx={2} />
                  <Rect x={cx + 1} y={padding.top + chartH - aH} width={barW} height={aH} fill={aColor} rx={2} />
                </G>
              );
            })}
            <SvgText x={qx + quarterW / 2} y={padding.top + chartH + 18} fontSize={12} fill={colors.mutedForeground} textAnchor="middle">{d.quarter}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

function BoardVarianceTable({ data }: { data: { lineItem: string; category: string; boardApproved: number; currentPlan: number; variance: number; variancePct: number }[] }) {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();

  return (
    <View>
      <View style={[tableStyles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[tableStyles.headerCell, tableStyles.cellName, { color: colors.mutedForeground }]}>Line Item</Text>
        <Text style={[tableStyles.headerCell, tableStyles.cellNum, { color: colors.mutedForeground }]}>Board Approved</Text>
        <Text style={[tableStyles.headerCell, tableStyles.cellNum, { color: colors.mutedForeground }]}>Current Plan</Text>
        <Text style={[tableStyles.headerCell, tableStyles.cellVar, { color: colors.mutedForeground }]}>Variance</Text>
      </View>
      {data.map((row, i) => (
        <View key={i} style={[tableStyles.row, { borderBottomColor: colors.border }]}>
          <View style={tableStyles.cellName}>
            <Text style={[tableStyles.itemName, { color: colors.foreground }]} numberOfLines={1}>{row.lineItem}</Text>
            <Text style={[tableStyles.itemCat, { color: colors.mutedForeground }]}>{row.category}</Text>
          </View>
          <Text style={[tableStyles.cellText, tableStyles.cellNum, { color: colors.foreground }]}>{formatCurrency(row.boardApproved)}</Text>
          <Text style={[tableStyles.cellText, tableStyles.cellNum, { color: colors.foreground }]}>{formatCurrency(row.currentPlan)}</Text>
          <Text style={[tableStyles.cellText, tableStyles.cellVar, { color: row.variance >= 0 ? "#16a34a" : "#dc2626" }]}>
            {row.variance >= 0 ? "+" : ""}{formatCurrency(row.variance)} ({row.variancePct >= 0 ? "+" : ""}{row.variancePct.toFixed(1)}%)
          </Text>
        </View>
      ))}
    </View>
  );
}

function useAnalytics(endpoint: string) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const baseUrl = getApiUrl();
    apiFetch(`${baseUrl}/api/analytics/${endpoint}?year=2026`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [endpoint]);

  return { data, loading };
}

function ReportsContent() {
  const { currency } = useCurrency();
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";
  const { width: windowWidth } = useWindowDimensions();

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  const { data: charts, isLoading: chartsLoading, isError: chartsError, refetch: refetchCharts } = useGetDashboardCharts({ year: 2026 });
  const { data: budgetLines, isLoading: linesLoading, isError: linesError, refetch: refetchLines } = useListBudgetLinesWithMonthly({ year: 2026 });

  const filteredLines = useMemo(() => {
    if (!budgetLines) return [] as BudgetLine[];
    const lines = budgetLines as BudgetLine[];
    if (channelFilter === "all") return lines;
    if (channelFilter === "none") return lines.filter((l) => !l.channel);
    return lines.filter((l) => l.channel === channelFilter);
  }, [budgetLines, channelFilter]);
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchCharts(), refetchLines()]);
    setRefreshing(false);
  };

  const [exporting, setExporting] = useState(false);
  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const token = await getSessionToken();
      const baseUrl = getApiUrl();
      const headers: Record<string, string> = {};
      if (token) headers["x-user-session"] = token;
      const res = await fetch(`${baseUrl}/api/exports/reports-pdf?currency=${currency}`, { headers });
      if (!res.ok) throw new Error("Export failed");
      if (Platform.OS === "web") {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "hubert-marketing-reports.pdf";
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunkSize = 8192;
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
          binary += String.fromCharCode(...Array.from(chunk));
        }
        const base64 = btoa(binary);
        const fileUri = `${FileSystem.cacheDirectory}hubert-marketing-reports.pdf`;
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: "application/pdf", dialogTitle: "Save Reports PDF", UTI: "com.adobe.pdf" });
        } else {
          Alert.alert("Error", "Sharing is not available on this device.");
        }
      }
    } catch {
      Alert.alert("Export Failed", "Could not generate the PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  }, []);

  const { data: ownerData } = useAnalytics("owner-breakdown");
  const { data: regionalData } = useAnalytics("regional-investment");
  const { data: fixedVarData } = useAnalytics("fixed-vs-variable");
  const { data: burndownData } = useAnalytics("category-burndown");
  const { data: boardVarData } = useAnalytics("board-variance");

  const pieData = useMemo(() => {
    const catMap = new Map<string, number>();
    const regMap = new Map<string, number>();
    const typeMap = new Map<string, number>();

    for (const bl of filteredLines) {
      const totalActual = (bl.actuals ?? []).reduce((s, a) => s + a.actualAmount, 0);
      catMap.set(bl.category, (catMap.get(bl.category) ?? 0) + totalActual);
      regMap.set(bl.region || "Global", (regMap.get(bl.region || "Global") ?? 0) + totalActual);
      typeMap.set(bl.costStatus || "Variable", (typeMap.get(bl.costStatus || "Variable") ?? 0) + totalActual);
    }

    const toArr = (m: Map<string, number>) => Array.from(m, ([label, value]) => ({ label, value })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
    return { byCategory: toArr(catMap), byRegion: toArr(regMap), byCostType: toArr(typeMap) };
  }, [filteredLines]);

  const channelPieData = useMemo(() => {
    if (!budgetLines) return [] as { label: string; value: number }[];
    const lines = budgetLines as BudgetLine[];
    const m = new Map<string, number>();
    for (const bl of lines) {
      const totalActual = (bl.actuals ?? []).reduce((s, a) => s + a.actualAmount, 0);
      if (totalActual <= 0) continue;
      const key = bl.channel && CHANNEL_VALUES.includes(bl.channel as ChannelValue)
        ? CHANNEL_LABELS[bl.channel as ChannelValue]
        : "Unassigned";
      m.set(key, (m.get(key) ?? 0) + totalActual);
    }
    return Array.from(m, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [budgetLines]);

  const ownerPieData = useMemo(() => {
    if (!ownerData) return { planned: [] as { label: string; value: number }[], actual: [] as { label: string; value: number }[] };
    const arr = ownerData as { owner: string; planned: number; actual: number }[];
    return {
      planned: arr.map(o => ({ label: o.owner, value: o.planned })).filter(d => d.value > 0),
      actual: arr.map(o => ({ label: o.owner, value: o.actual })).filter(d => d.value > 0),
    };
  }, [ownerData]);

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

  const regionalChartData = useMemo(() => {
    if (!regionalData) return { regions: [] as string[], quarters: [] as { quarter: string; [key: string]: unknown }[] };
    const rd = regionalData as { regions: string[]; quarters: { quarter: string; [key: string]: unknown }[] };
    return rd;
  }, [regionalData]);

  const fixedVarChartData = useMemo(() => {
    if (!fixedVarData) return [];
    return (fixedVarData as { label: string; fixedActual: number; variableActual: number }[]);
  }, [fixedVarData]);

  const burndownChartData = useMemo(() => {
    if (!burndownData) return { categories: [] as string[], monthly: [] as Record<string, unknown>[] };
    const bd = burndownData as { categories: string[]; monthly: Record<string, unknown>[] };
    return bd;
  }, [burndownData]);

  if (chartsLoading || linesLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if ((chartsError || linesError) && !charts && !budgetLines) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState
          title="Failed to load reports"
          message="We couldn't fetch report data. Check your connection and try again."
          onRetry={() => { refetchCharts(); refetchLines(); }}
        />
      </View>
    );
  }

  const pieSize = isDesktop ? 200 : 180;
  const desktopContentWidth = windowWidth - 240 - 96;
  const chartWidth = isDesktop ? Math.min((desktopContentWidth - 16) / 2, 500) : windowWidth - 80;
  const fullChartWidth = isDesktop ? Math.min(desktopContentWidth, 900) : windowWidth - 80;

  const content = (
    <View style={{ flex: 1 }}>
    <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
    <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
        <View style={{ flex: 1 }}>
          <SectionHeader title="Reports" subtitle={`Visual analytics and spend distribution \u00b7 FY2026`} />
        </View>
        <TouchableOpacity
          onPress={handleExportPdf}
          disabled={exporting}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: exporting ? colors.muted : colors.primary,
            marginTop: 4,
          }}
        >
          {exporting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="download" size={14} color="#fff" />}
          <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
            {exporting ? "Generating…" : "Export PDF"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.channelFilterRow}>
        <Text style={[styles.channelFilterLabel, { color: colors.mutedForeground }]}>Channel:</Text>
        {([
          { key: "all", label: "All" },
          { key: "none", label: "Unassigned" },
          ...CHANNEL_VALUES.map((v) => ({ key: v, label: CHANNEL_LABELS[v] })),
        ] as { key: ChannelFilter; label: string }[]).map((opt) => {
          const active = channelFilter === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setChannelFilter(opt.key)}
              style={[
                styles.channelChip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "500" }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {channelPieData.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <SectionHeader title="Spend by Channel" subtitle="Actual spend grouped by go-to-market channel" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <PieChart data={channelPieData} size={pieSize} title="" />
          </View>
        </View>
      )}

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

      {ownerPieData.planned.length > 0 && (
        <>
          <SectionHeader title="Owner Breakdown" subtitle="Budget responsibility by team member" />
          <View style={[styles.pieRow, { flexDirection: isDesktop ? "row" : "column" }]}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
              <PieChart data={ownerPieData.planned} size={pieSize} title="Planned Budget by Owner" />
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
              <PieChart data={ownerPieData.actual} size={pieSize} title="Actual Spend by Owner" />
            </View>
          </View>
        </>
      )}

      {regionalChartData.regions.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <SectionHeader title="Regional Investment" subtitle="Planned vs actual spend by region per quarter" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
              <RegionalInvestmentChart
                data={regionalChartData.quarters}
                regions={regionalChartData.regions}
                width={isDesktop ? fullChartWidth : 600}
                height={300}
              />
            </ScrollView>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              {regionalChartData.regions.map((r) => (
                <View key={r} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: REGION_COLORS[r]?.planned ?? "#6b7280" }} />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{r}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      <View style={[styles.twoCol, { flexDirection: isDesktop ? "row" : "column" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Planned vs Actual by Quarter</Text>
          <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
            <QuarterlyCompareChart data={quarterlyData} width={isDesktop ? chartWidth : 360} height={260} />
          </ScrollView>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flex: isDesktop ? 1 : undefined }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Monthly Spend Trend</Text>
          <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
            <MonthlyTrendLine data={monthlyTrend} width={isDesktop ? chartWidth : 400} height={260} />
          </ScrollView>
        </View>
      </View>

      {fixedVarChartData.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <SectionHeader title="Fixed vs Variable Costs" subtitle="Monthly split between committed and discretionary spend" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
              <FixedVsVariableChart data={fixedVarChartData} width={isDesktop ? fullChartWidth : 500} height={280} />
            </ScrollView>
          </View>
        </View>
      )}

      {burndownChartData.categories.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <SectionHeader title="Category Burn-Down" subtitle="Remaining budget per category over time" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
              <CategoryBurndownChart
                data={burndownChartData.monthly}
                categories={burndownChartData.categories}
                width={isDesktop ? fullChartWidth : 500}
                height={300}
              />
            </ScrollView>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              {burndownChartData.categories.map((cat, i) => (
                <View key={cat} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: BURNDOWN_COLORS[i % BURNDOWN_COLORS.length] }} />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{cat}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {Array.isArray(boardVarData) && boardVarData.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <SectionHeader title="Board Sign-Off Variance" subtitle="Current plan vs December 2025 board-approved amounts" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView horizontal={!isDesktop} showsHorizontalScrollIndicator={false}>
              <View style={{ minWidth: isDesktop ? undefined : 600 }}>
                <BoardVarianceTable data={boardVarData as { lineItem: string; category: string; boardApproved: number; currentPlan: number; variance: number; variancePct: number }[]} />
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </ScrollView>
    </View>
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

const tableStyles = StyleSheet.create({
  headerRow: { flexDirection: "row", borderBottomWidth: 1, paddingBottom: 8, marginBottom: 4 },
  headerCell: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const },
  row: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, alignItems: "center" },
  cellName: { flex: 2, paddingRight: 8 },
  cellNum: { flex: 1, textAlign: "right" as const },
  cellVar: { flex: 1.2, textAlign: "right" as const },
  cellText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  itemName: { fontSize: 12, fontFamily: "Inter_500Medium" },
  itemCat: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
});

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  pieRow: { gap: 16, marginBottom: 20 },
  channelFilterRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  channelFilterLabel: { fontSize: 12, fontWeight: "500", marginRight: 4 },
  channelChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  twoCol: { gap: 16 },
  card: { padding: 20, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
});
