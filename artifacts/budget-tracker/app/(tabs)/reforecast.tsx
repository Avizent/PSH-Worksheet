import React, { useState, useMemo } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { AdminSubnav } from "@/components/AdminSubnav";
import { SectionHeader } from "@/components/SectionHeader";
import {
  useListForecastVersions,
  useGetForecastVersion,
  useCreateForecastVersion,
  useCompareForecastVersions,
  useListBudgetLinesWithMonthly,
  useListAlerts,
  getListForecastVersionsQueryKey,
  getGetForecastVersionQueryKey,
  getCompareForecastVersionsQueryKey,
  type ListForecastVersionsQueryResult,
  type ForecastVersion,
  type GetForecastVersionQueryResult,
  type CompareForecastVersionsQueryResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrency } from "@/contexts/CurrencyContext";

interface ForecastPlan {
  budgetLineId: number;
  month: number;
  plannedAmount: number;
}

interface ComparisonLine {
  budgetLineId: number;
  lineItem: string;
  category: string;
  months: ComparisonMonth[];
}

interface ComparisonMonth {
  month: number;
  basePlanned: number;
  comparePlanned: number;
  delta: number;
}

interface BudgetLineWithMonthly {
  id: number;
  lineItem: string;
  category: string;
  monthlyPlans?: { month: number; plannedAmount: number }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_MONTH = new Date().getMonth() + 1;

export default function ReforecastScreen() {
  const { format: formatCurrency } = useCurrency();
  const colors = useColors();
  const { mode, width } = useLayout();
  const isDesktop = mode === "desktop";
  const queryClient = useQueryClient();

  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [editedPlans, setEditedPlans] = useState<Record<string, string>>({});

  const [createError, setCreateError] = useState("");
  const { data: versions, isLoading: versionsLoading, isError: versionsError, refetch: refetchVersions } = useListForecastVersions({ year: 2026 });
  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const { data: budgetLinesData } = useListBudgetLinesWithMonthly({ year: 2026 });

  const originalVersion = versions?.find((v) => v.isOriginal);
  const latestVersion = versions?.[0];

  const activeVersionId = selectedVersionId ?? latestVersion?.id;
  const activeVersion = versions?.find((v) => v.id === activeVersionId);

  const { data: versionDetail } = useGetForecastVersion(activeVersionId ?? 0, {
    query: {
      enabled: !!activeVersionId,
      queryKey: getGetForecastVersionQueryKey(activeVersionId ?? 0),
    },
  });

  const compareBaseId = originalVersion?.id;
  const { data: comparison } = useCompareForecastVersions(
    { baseVersionId: compareBaseId ?? 0, compareVersionId: activeVersionId ?? 0 },
    {
      query: {
        enabled: !!compareBaseId && !!activeVersionId && compareBaseId !== activeVersionId,
        queryKey: getCompareForecastVersionsQueryKey({
          baseVersionId: compareBaseId ?? 0,
          compareVersionId: activeVersionId ?? 0,
        }),
      },
    },
  );

  const createMutation = useCreateForecastVersion();

  const plansByLine = useMemo(() => {
    if (!versionDetail?.plans) return new Map();
    const map = new Map<number, Map<number, number>>();
    for (const p of versionDetail.plans as ForecastPlan[]) {
      if (!map.has(p.budgetLineId)) map.set(p.budgetLineId, new Map());
      map.get(p.budgetLineId)!.set(p.month, p.plannedAmount);
    }
    return map;
  }, [versionDetail]);

  const originalPlansByLine = useMemo(() => {
    if (!budgetLinesData) return new Map();
    const map = new Map<number, Map<number, number>>();
    for (const bl of budgetLinesData as BudgetLineWithMonthly[]) {
      const monthMap = new Map<number, number>();
      for (const mp of bl.monthlyPlans ?? []) {
        monthMap.set(mp.month, mp.plannedAmount);
      }
      map.set(bl.id, monthMap);
    }
    return map;
  }, [budgetLinesData]);

  const handleSubmitReforecast = () => {
    if (!newName.trim() || !budgetLinesData) return;

    const plans: { budgetLineId: number; month: number; plannedAmount: number }[] = [];
    for (const bl of budgetLinesData as BudgetLineWithMonthly[]) {
      for (let m = 1; m <= 12; m++) {
        const key = `${bl.id}-${m}`;
        const edited = editedPlans[key];
        const original = originalPlansByLine.get(bl.id)?.get(m) ?? 0;
        const current = plansByLine.get(bl.id)?.get(m) ?? original;
        const amount = edited != null ? parseFloat(edited) || 0 : current;
        plans.push({ budgetLineId: bl.id, month: m, plannedAmount: amount });
      }
    }

    setCreateError("");
    createMutation.mutate(
      { data: { name: newName.trim(), plans, year: 2026 } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListForecastVersionsQueryKey() });
          setShowCreate(false);
          setNewName("");
          setEditedPlans({});
          setCreateError("");
        },
        onError: (err: Error) => {
          setCreateError(err?.message ?? "Failed to create reforecast. Please try again.");
        },
      },
    );
  };

  const isLatest = activeVersion && latestVersion && activeVersion.id === latestVersion.id;
  const canEdit = isLatest;

  if (versionsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (versionsError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color="#dc2626" />
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, marginTop: 12 }}>Failed to load forecast versions</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>Check your connection and try again.</Text>
        <TouchableOpacity onPress={() => refetchVersions()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}>
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => refetchVersions()} />}
    >
      {!isDesktop && <AdminSubnav active="reforecast" />}
      <SectionHeader title="Reforecast" subtitle="Manage budget forecast versions" />

      <View style={[styles.versionBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>Active Version</Text>
          <Text style={[styles.versionName, { color: colors.foreground }]}>
            {activeVersion?.name ?? "No versions"}
          </Text>
          {activeVersion && (
            <Text style={[styles.versionMeta, { color: colors.mutedForeground }]}>
              v{activeVersion.versionNumber} · {new Date(activeVersion.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </Text>
          )}
        </View>
        {isDesktop && (
          <TouchableOpacity
            onPress={() => { setEditedPlans({}); setNewName(""); setShowCreate(true); }}
            disabled={!canEdit}
            style={[styles.createButton, { backgroundColor: colors.primary, opacity: canEdit ? 1 : 0.5 }]}
          >
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.createButtonText}>New Reforecast</Text>
          </TouchableOpacity>
        )}
      </View>

      {versions && versions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          {versions.map((v) => (
            <TouchableOpacity
              key={v.id}
              onPress={() => setSelectedVersionId(v.id)}
              style={[
                styles.versionChip,
                {
                  backgroundColor: v.id === activeVersionId ? colors.primary : colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: v.id === activeVersionId ? "#fff" : colors.foreground,
              }}>
                v{v.versionNumber}: {v.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {comparison && comparison.lines && compareBaseId !== activeVersionId ? (
        <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.tableTitle, { color: colors.foreground }]}>
            Original vs {activeVersion?.name}
          </Text>
          {isDesktop ? (
            <ScrollView horizontal>
              <View>
                <View style={[styles.tableRow, styles.tableHeader, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.headerCell, styles.lineItemCol, { color: colors.foreground }]}>Line Item</Text>
                  {MONTHS.map((m, i) => (
                    <Text key={m} style={[styles.headerCell, styles.monthCol, { color: colors.foreground }]}>{m}</Text>
                  ))}
                </View>
                {(comparison.lines as ComparisonLine[]).map((line) => (
                  <View key={line.budgetLineId} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                    <View style={styles.lineItemCol}>
                      <Text style={[styles.cellText, { color: colors.foreground }]}>{line.lineItem}</Text>
                      <Text style={[styles.cellSubtext, { color: colors.mutedForeground }]}>{line.category}</Text>
                    </View>
                    {(line.months as ComparisonMonth[]).map((m) => {
                      const delta = m.delta;
                      const deltaColor = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : colors.mutedForeground;
                      return (
                        <View key={m.month} style={styles.monthCol}>
                          <Text style={[styles.cellText, { color: colors.foreground, fontSize: 12 }]}>
                            {formatCurrency(m.comparePlanned)}
                          </Text>
                          {delta !== 0 && (
                            <Text style={{ fontSize: 10, color: deltaColor, fontFamily: "Inter_500Medium" }}>
                              {delta > 0 ? "+" : ""}{formatCurrency(delta)}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View>
              {(comparison.lines as ComparisonLine[]).slice(0, 8).map((line) => {
                const totalDelta = (line.months as ComparisonMonth[]).reduce((s: number, m: ComparisonMonth) => s + m.delta, 0);
                return (
                  <View key={line.budgetLineId} style={[styles.mobileCompareRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cellText, { color: colors.foreground }]}>{line.lineItem}</Text>
                      <Text style={[styles.cellSubtext, { color: colors.mutedForeground }]}>{line.category}</Text>
                    </View>
                    <Text style={{
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                      color: totalDelta > 0 ? "#16a34a" : totalDelta < 0 ? "#dc2626" : colors.mutedForeground,
                    }}>
                      {totalDelta > 0 ? "+" : ""}{formatCurrency(totalDelta)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : versionDetail && (
        <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.tableTitle, { color: colors.foreground }]}>
            {activeVersion?.name} — Plan Details
          </Text>
          <Text style={[styles.cellSubtext, { color: colors.mutedForeground, marginBottom: 8 }]}>
            {versionDetail.plans ? (versionDetail.plans as ForecastPlan[]).length : 0} plan entries
          </Text>
        </View>
      )}

      {!isDesktop && (
        <View style={[styles.mobileStatusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="refresh-cw" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.cellText, { color: colors.foreground }]}>Active Forecast</Text>
            <Text style={[styles.cellSubtext, { color: colors.mutedForeground }]}>
              {latestVersion?.name ?? "No versions"} · {latestVersion ? new Date(latestVersion.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopLayout, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={alertCount} />
        <View style={{ flex: 1 }}>
          {content}
          <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCreate(false)}>
              <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Submit New Reforecast</Text>
                <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>Version Name</Text>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="e.g. Q3 Reforecast"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.modalInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                />
                <Text style={[styles.modalLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
                  Edit future month amounts below (months 1–{CURRENT_MONTH - 1} are locked):
                </Text>
                <ScrollView style={{ maxHeight: 400, marginTop: 8 }}>
                  {budgetLinesData && (budgetLinesData as BudgetLineWithMonthly[]).map((bl) => (
                    <View key={bl.id} style={{ marginBottom: 12 }}>
                      <Text style={[styles.cellText, { color: colors.foreground, marginBottom: 4 }]}>{bl.lineItem}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                        {MONTHS.map((m, i) => {
                          const month = i + 1;
                          const isPast = month < CURRENT_MONTH;
                          const key = `${bl.id}-${month}`;
                          const original = originalPlansByLine.get(bl.id)?.get(month) ?? 0;
                          const current = plansByLine.get(bl.id)?.get(month) ?? original;
                          return (
                            <View key={month} style={{ width: 72 }}>
                              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{m}</Text>
                              <TextInput
                                value={editedPlans[key] ?? String(current)}
                                onChangeText={(v) => setEditedPlans(prev => ({ ...prev, [key]: v }))}
                                editable={!isPast}
                                keyboardType="numeric"
                                style={[
                                  styles.planInput,
                                  {
                                    backgroundColor: isPast ? colors.muted : colors.background,
                                    color: isPast ? colors.mutedForeground : colors.foreground,
                                    borderColor: colors.border,
                                  },
                                ]}
                              />
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </ScrollView>
                {createError ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, padding: 10, backgroundColor: "#dc262615", borderRadius: 8 }}>
                    <Feather name="alert-circle" size={16} color="#dc2626" />
                    <Text style={{ color: "#dc2626", fontFamily: "Inter_500Medium", fontSize: 13, marginLeft: 8, flex: 1 }}>{createError}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                  <TouchableOpacity onPress={() => setShowCreate(false)} style={[styles.cancelButton, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSubmitReforecast}
                    disabled={!newName.trim() || createMutation.isPending}
                    style={[styles.submitButton, { backgroundColor: colors.primary, opacity: newName.trim() ? 1 : 0.5 }]}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                      {createMutation.isPending ? "Submitting..." : "Submit Reforecast"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </View>
      </View>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  desktopLayout: { flex: 1, flexDirection: "row" },
  versionBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  versionLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.5, textTransform: "uppercase" },
  versionName: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  versionMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createButtonText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  versionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  tableCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  tableTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 8 },
  tableHeader: { borderBottomWidth: 2 },
  headerCell: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  lineItemCol: { width: 160, paddingRight: 8 },
  monthCol: { width: 72, alignItems: "flex-end" as const },
  cellText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  cellSubtext: { fontSize: 11, fontFamily: "Inter_400Regular" },
  mobileCompareRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  mobileStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxWidth: 800,
    maxHeight: "85%",
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 16 },
  modalLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  planInput: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "right" as const,
    marginTop: 2,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  submitButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
});
