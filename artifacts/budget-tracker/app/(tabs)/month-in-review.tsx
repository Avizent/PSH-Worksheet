import React, { useMemo, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  ActivityIndicator,
  useWindowDimensions,
  TouchableOpacity,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { useListBudgetLinesWithMonthly, useListAlerts } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { QuarterlyBody } from "./quarterly";
import { useCurrency } from "@/contexts/CurrencyContext";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtPct(actual: number, planned: number): string {
  if (planned === 0) return "-";
  return ((actual / planned) * 100).toFixed(0) + "%";
}

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

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "neutral" | "over" | "under";
}

function KpiCard({ label, value, sub, accent = "neutral" }: KpiCardProps) {
  const colors = useColors();
  const accentColor =
    accent === "over" ? colors.destructive ?? "#ef4444"
    : accent === "under" ? colors.success ?? "#16a34a"
    : colors.foreground;
  return (
    <View style={[kpiStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[kpiStyles.value, { color: accentColor }]}>{value}</Text>
      <Text style={[kpiStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      {sub ? <Text style={[kpiStyles.sub, { color: colors.mutedForeground }]}>{sub}</Text> : null}
    </View>
  );
}

interface LineRowProps {
  rank: number;
  lineItem: string;
  category: string;
  owner?: string | null;
  planned: number;
  actual: number;
  variance: number;
  isOver: boolean;
}

function LineRow({ rank, lineItem, category, owner, planned, actual, variance, isOver }: LineRowProps) {
  const { format: fmt } = useCurrency();
  const colors = useColors();
  const varColor = isOver
    ? colors.destructive ?? "#ef4444"
    : colors.success ?? "#16a34a";
  return (
    <View style={[rowStyles.row, { borderBottomColor: colors.border }]}>
      <Text style={[rowStyles.rank, { color: colors.mutedForeground }]}>{rank}</Text>
      <View style={rowStyles.nameCol}>
        <Text style={[rowStyles.name, { color: colors.foreground }]} numberOfLines={2}>{lineItem}</Text>
        <Text style={[rowStyles.meta, { color: colors.mutedForeground }]}>{category}{owner ? ` · ${owner}` : ""}</Text>
      </View>
      <Text style={[rowStyles.num, { color: colors.mutedForeground }]}>{fmt(planned)}</Text>
      <Text style={[rowStyles.num, { color: colors.foreground }]}>{fmt(actual)}</Text>
      <View style={rowStyles.varCol}>
        <Text style={[rowStyles.num, { color: varColor, fontFamily: "Inter_600SemiBold" }]}>
          {isOver ? "+" : ""}{fmt(variance)}
        </Text>
        <Text style={[rowStyles.pct, { color: varColor }]}>{varPct(actual, planned)}</Text>
      </View>
    </View>
  );
}

function MirBody() {
  const { format: fmt } = useCurrency();
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const { width: windowWidth } = useWindowDimensions();

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const monthName = MONTH_NAMES[currentMonth - 1];

  const { data: budgetLines, isLoading, isError, refetch } = useListBudgetLinesWithMonthly({ year: 2026 });

  const { kpis, overLines, underLines, top5 } = useMemo(() => {
    if (!budgetLines) return { kpis: null, overLines: [], underLines: [], top5: [] };
    const lines = budgetLines as BudgetLine[];

    const computed = lines.map((bl) => {
      const planned = (bl.plans ?? []).find((p) => p.month === currentMonth)?.plannedAmount ?? 0;
      const actual = (bl.actuals ?? []).find((a) => a.month === currentMonth)?.actualAmount ?? 0;
      return {
        id: bl.id,
        lineItem: bl.lineItem,
        category: bl.category,
        owner: bl.owner,
        planned,
        actual,
        variance: actual - planned,
      };
    }).filter((l) => l.planned > 0 || l.actual > 0);

    const totalPlanned = computed.reduce((s, l) => s + l.planned, 0);
    const totalActual = computed.reduce((s, l) => s + l.actual, 0);
    const totalVariance = totalActual - totalPlanned;
    const utilisation = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;

    const over = computed.filter((l) => l.variance > 0).sort((a, b) => b.variance - a.variance);
    const under = computed.filter((l) => l.variance < 0).sort((a, b) => a.variance - b.variance);
    const t5 = [...computed].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 5);

    return {
      kpis: { totalPlanned, totalActual, totalVariance, utilisation },
      overLines: over,
      underLines: under,
      top5: t5,
    };
  }, [budgetLines, currentMonth]);

  const [refreshing, setRefreshing] = React.useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !budgetLines) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState
          title="Failed to load data"
          message="Could not fetch month-in-review data. Check your connection and try again."
          onRetry={refetch}
        />
      </View>
    );
  }

  const varAccent = kpis && kpis.totalVariance > 0 ? "over" : kpis && kpis.totalVariance < 0 ? "under" : "neutral";
  const tableWidth = isDesktop ? Math.min(windowWidth - 240 - 96, 900) : windowWidth - 48;

  return (
    <View style={{ flex: 1 }}>
      <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 40 : 120 }]}
      >
        <SectionHeader
          title={`${monthName} in Review`}
          subtitle={`Budget brief for ${monthName} 2026 · Plan vs Actual`}
        />

        {kpis && (
          <View style={[styles.kpiRow, { flexDirection: "row", flexWrap: "wrap" }]}>
            <KpiCard label="Planned" value={fmt(kpis.totalPlanned)} />
            <KpiCard label="Actual Spend" value={fmt(kpis.totalActual)} />
            <KpiCard
              label="Variance"
              value={(kpis.totalVariance > 0 ? "+" : "") + fmt(kpis.totalVariance)}
              sub={varPct(kpis.totalActual, kpis.totalPlanned)}
              accent={varAccent}
            />
            <KpiCard
              label="Utilisation"
              value={kpis.utilisation.toFixed(0) + "%"}
              sub={`of ${monthName} budget`}
              accent={kpis.utilisation > 110 ? "over" : kpis.utilisation < 50 ? "under" : "neutral"}
            />
          </View>
        )}

        <View style={{ marginTop: 24 }}>
          <View style={[styles.sectionLabel, { borderColor: colors.border }]}>
            <View style={[styles.sectionDot, { backgroundColor: "#ef4444" }]} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Over Budget</Text>
            <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
              {overLines.length} {overLines.length === 1 ? "line" : "lines"}
            </Text>
          </View>
          {overLines.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={20} color={colors.success ?? "#16a34a"} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No lines are over budget this month</Text>
            </View>
          ) : (
            <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ minWidth: isDesktop ? undefined : tableWidth }}>
                <View style={[rowStyles.header, { borderBottomColor: colors.border }]}>
                  <Text style={[rowStyles.rank, { color: colors.mutedForeground }]}>#</Text>
                  <Text style={[rowStyles.headerName, { color: colors.mutedForeground }]}>Line Item</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Planned</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Actual</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Over by</Text>
                </View>
                {overLines.map((l, i) => (
                  <LineRow key={l.id} rank={i + 1} lineItem={l.lineItem} category={l.category} owner={l.owner} planned={l.planned} actual={l.actual} variance={l.variance} isOver />
                ))}
              </View>
            </View>
          )}
        </View>

        <View style={{ marginTop: 24 }}>
          <View style={[styles.sectionLabel, { borderColor: colors.border }]}>
            <View style={[styles.sectionDot, { backgroundColor: "#16a34a" }]} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Under Budget</Text>
            <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
              {underLines.length} {underLines.length === 1 ? "line" : "lines"}
            </Text>
          </View>
          {underLines.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="info" size={20} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No lines are under budget this month</Text>
            </View>
          ) : (
            <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ minWidth: isDesktop ? undefined : tableWidth }}>
                <View style={[rowStyles.header, { borderBottomColor: colors.border }]}>
                  <Text style={[rowStyles.rank, { color: colors.mutedForeground }]}>#</Text>
                  <Text style={[rowStyles.headerName, { color: colors.mutedForeground }]}>Line Item</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Planned</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Actual</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Unspent</Text>
                </View>
                {underLines.map((l, i) => (
                  <LineRow key={l.id} rank={i + 1} lineItem={l.lineItem} category={l.category} owner={l.owner} planned={l.planned} actual={l.actual} variance={l.variance} isOver={false} />
                ))}
              </View>
            </View>
          )}
        </View>

        {top5.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <View style={[styles.sectionLabel, { borderColor: colors.border }]}>
              <View style={[styles.sectionDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top 5 Variances</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>by absolute value</Text>
            </View>
            <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ minWidth: isDesktop ? undefined : tableWidth }}>
                <View style={[rowStyles.header, { borderBottomColor: colors.border }]}>
                  <Text style={[rowStyles.rank, { color: colors.mutedForeground }]}>#</Text>
                  <Text style={[rowStyles.headerName, { color: colors.mutedForeground }]}>Line Item</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Planned</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Actual</Text>
                  <Text style={[rowStyles.headerNum, { color: colors.mutedForeground }]}>Variance</Text>
                </View>
                {top5.map((l, i) => (
                  <LineRow key={l.id} rank={i + 1} lineItem={l.lineItem} category={l.category} owner={l.owner} planned={l.planned} actual={l.actual} variance={l.variance} isOver={l.variance > 0} />
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

type ViewMode = "month" | "quarterly";

function ViewSwitcher({ active, onChange }: { active: ViewMode; onChange: (v: ViewMode) => void }) {
  const colors = useColors();
  return (
    <View style={[switcherStyles.bar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {(["month", "quarterly"] as ViewMode[]).map((v) => {
        const isActive = active === v;
        const label = v === "month" ? "Month in Review" : "Quarterly";
        const icon: keyof typeof Feather.glyphMap = v === "month" ? "zap" : "bar-chart-2";
        return (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            activeOpacity={0.8}
            style={[
              switcherStyles.btn,
              isActive && { backgroundColor: colors.primary },
            ]}
          >
            <Feather name={icon} size={13} color={isActive ? "#fff" : colors.mutedForeground} />
            <Text style={[switcherStyles.label, { color: isActive ? "#fff" : colors.mutedForeground }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function MonthInReviewScreen() {
  const [activeView, setActiveView] = useState<ViewMode>("month");
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const colors = useColors();
  const { data: alerts } = useListAlerts({ resolved: false });
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const body = (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ViewSwitcher active={activeView} onChange={setActiveView} />
      {activeView === "month" ? <MirBody /> : <QuarterlyBody />}
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={alertCount} />
        <View style={{ flex: 1 }}>{body}</View>
      </View>
    );
  }
  return body;
}

const switcherStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderBottomWidth: 1,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});

const kpiStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 120,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  value: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 4 },
  label: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
});

const rowStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
  },
  headerName: { flex: 3, fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const },
  headerNum: { flex: 1.2, fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, textAlign: "right" as const },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  rank: { width: 24, fontSize: 12, fontFamily: "Inter_500Medium" },
  nameCol: { flex: 3, paddingRight: 8 },
  name: { fontSize: 13, fontFamily: "Inter_500Medium" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  num: { flex: 1.2, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "right" as const },
  varCol: { flex: 1.2, alignItems: "flex-end" },
  pct: { fontSize: 11, fontFamily: "Inter_400Regular" },
});

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  scroll: { flex: 1 },
  content: { padding: 24 },
  kpiRow: { gap: 12, marginTop: 8 },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sectionCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tableCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
