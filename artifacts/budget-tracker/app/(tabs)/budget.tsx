import React, { useState, useMemo, useRef, useEffect } from "react";
import { View, ScrollView, StyleSheet, Text, Platform, ActivityIndicator, RefreshControl, TextInput, Modal, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { BudgetTable, confirmDelete, CHANNEL_VALUES, CHANNEL_LABELS, type ChannelValue, type SortField, type SortDir, type BudgetLineRow } from "@/components/BudgetTable";
import { MonthlyAmountModal } from "@/components/MonthlyAmountModal";
import { AddLineModal } from "@/components/AddLineModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { ToastProvider, useToast } from "@/components/Toast";
import { InlineText, PickerCell, StatusBadge, nextStatus, type PickerOption } from "@/components/InlineEdits";
import {
  useListBudgetLinesWithMonthly,
  useListAlerts,
  useListBudgetLines,
  useUpdateBudgetLine,
  useCreateBudgetLine,
  useDeleteBudgetLine,
  useUpsertMonthlyPlanByLine,
  useUpsertMonthlyActualByLine,
  useListBudgetLineCategories,
  useListOwners,
  getListBudgetLinesWithMonthlyQueryKey,
  getListBudgetLinesQueryKey,
  getGetProjectionsQueryKey,
  getListBudgetLineCategoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const FY_YEAR = 2026;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SORT_ACCESSORS: Record<SortField, (r: BudgetLineRow) => string | number> = {
  lineItem: (r) => r.lineItem,
  category: (r) => r.category,
  owner: (r) => r.owner ?? "",
  channel: (r) => r.channel ?? "",
  costStatus: (r) => r.costStatus,
  totalPlan: (r) => r.totalPlan,
  totalActual: (r) => r.totalActual,
  variance: (r) => r.variance,
};

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function ProjectionEditor({ lineId, lineItem, currentPct, onClose, onSaved, onError }: { lineId: number; lineItem: string; currentPct: number; onClose: () => void; onSaved: () => void; onError: () => void }) {
  const colors = useColors();
  const updateMutation = useUpdateBudgetLine();
  const [pctValue, setPctValue] = useState(String(currentPct));

  const handleSave = () => {
    const numVal = parseFloat(pctValue) || 0;
    updateMutation.mutate(
      { id: lineId, data: { projectionPct: numVal } },
      {
        onSuccess: () => { onSaved(); onClose(); },
        onError: () => { onError(); },
      }
    );
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <View style={styles.modalHandle}><View style={[styles.handleBar, { backgroundColor: colors.border }]} /></View>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Projection Assumption</Text>
          <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>{lineItem}</Text>
          <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>Annual % change for forward projection</Text>
          <View style={styles.modalInputRow}>
            <TextInput style={[styles.modalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} value={pctValue} onChangeText={setPctValue} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground} autoFocus />
            <Text style={[styles.modalPctSign, { color: colors.mutedForeground }]}>%</Text>
          </View>
          <TouchableOpacity style={[styles.modalSaveButton, { backgroundColor: colors.primary }]} onPress={handleSave} activeOpacity={0.7}>
            <Text style={[styles.modalSaveText, { color: colors.primaryForeground }]}>{updateMutation.isPending ? "Saving..." : "Save"}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function BudgetContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: budgetLines, isLoading, isError, refetch } = useListBudgetLinesWithMonthly();
  const { data: allLines } = useListBudgetLines();
  const { data: alerts } = useListAlerts({ resolved: false });
  const { data: categoriesData } = useListBudgetLineCategories();
  const { data: ownersData } = useListOwners();
  const updateMutation = useUpdateBudgetLine();
  const createMutation = useCreateBudgetLine();
  const deleteMutation = useDeleteBudgetLine();
  const upsertPlan = useUpsertMonthlyPlanByLine();
  const upsertActual = useUpsertMonthlyActualByLine();

  const [refreshing, setRefreshing] = useState(false);
  const [editingLine, setEditingLine] = useState<{ id: number; lineItem: string; pct: number } | null>(null);
  const params = useLocalSearchParams<{ owner?: string; category?: string }>();
  const router = useRouter();
  const initialOwner = typeof params.owner === "string" ? params.owner : "";
  const initialCategory = typeof params.category === "string" ? params.category : "All";
  const [filterCategory, setFilterCategory] = useState<string>(initialCategory);
  const [filterChannel, setFilterChannel] = useState<string>("All");
  const [filterMonth, setFilterMonth] = useState<number>(0);
  const [filterOwner, setFilterOwner] = useState<string>(initialOwner);
  useEffect(() => {
    if (typeof params.owner === "string" && params.owner !== filterOwner) {
      setFilterOwner(params.owner);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.owner]);
  useEffect(() => {
    if (typeof params.category === "string" && params.category !== filterCategory) {
      setFilterCategory(params.category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.category]);
  const clearOwnerFilter = () => {
    setFilterOwner("");
    router.setParams({ owner: undefined });
  };
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [amountMode, setAmountMode] = useState<"plan" | "actual">("plan");
  const [addOpen, setAddOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState<{ id: number; lineItem: string; mode: "plan" | "actual" } | null>(null);
  const monthlySession = useRef(0);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBudgetLinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProjectionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBudgetLineCategoriesQueryKey() });
  };

  const handleDesktopPctChange = (lineId: number, val: string) => {
    const numVal = parseFloat(val) || 0;
    updateMutation.mutate({ id: lineId, data: { projectionPct: numVal } }, {
      onSuccess: () => { invalidateAll(); toast.show("Projection saved", { kind: "success" }); },
      onError: () => toast.show("Failed to save projection", { kind: "error" }),
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortField(null); setSortDir(null); return; }
    setSortDir("asc");
  };

  const handleUpdateField = (id: number, field: "lineItem" | "category" | "owner" | "channel" | "costStatus", value: string) => {
    // Send empty string for owner/channel clearing (server normalizes "" to null);
    // for other fields, send the value as-is.
    const data: { lineItem?: string; category?: string; owner?: string; channel?: string | null; costStatus?: string } = {};
    if (field === "owner") {
      data.owner = value.trim();
    } else if (field === "channel") {
      // Channel is a strict enum on the server; send null to clear.
      const trimmed = value.trim();
      data.channel = trimmed === "" ? null : trimmed;
    } else {
      data[field] = value;
    }
    updateMutation.mutate(
      { id, data },
      {
        onSuccess: () => { invalidateAll(); toast.show("Saved", { kind: "success" }); },
        onError: () => { toast.show(`Failed to update ${field}`, { kind: "error" }); invalidateAll(); },
      }
    );
  };

  const handleDelete = (id: number, lineItem: string) => {
    // Optimistic hide; commit DELETE after toast window unless user undoes
    setPendingDeleteIds((s) => { const n = new Set(s); n.add(id); return n; });
    toast.showUndo(`Deleted "${lineItem}"`, {
      onUndo: () => {
        setPendingDeleteIds((s) => { const n = new Set(s); n.delete(id); return n; });
        toast.show("Restored", { kind: "info" });
      },
      onTimeout: () => {
        deleteMutation.mutate({ id }, {
          onSuccess: () => { invalidateAll(); setPendingDeleteIds((s) => { const n = new Set(s); n.delete(id); return n; }); },
          onError: () => {
            setPendingDeleteIds((s) => { const n = new Set(s); n.delete(id); return n; });
            toast.show(`Failed to delete "${lineItem}"`, { kind: "error" });
          },
        });
      },
      durationMs: 5000,
    });
  };

  const handleCreate = (data: { lineItem: string; category: string; owner?: string; costStatus: string; region?: string; channel?: string | null }) => {
    createMutation.mutate({ data }, {
      onSuccess: () => { invalidateAll(); setAddOpen(false); toast.show(`Added "${data.lineItem}"`, { kind: "success" }); },
      onError: () => toast.show("Failed to add line", { kind: "error" }),
    });
  };

  const handleSaveMonthly = (changes: { month: number; year: number; amount: number }[]) => {
    if (!monthlyOpen) return;
    const id = monthlyOpen.id;
    const isPlan = monthlyOpen.mode === "plan";
    if (changes.length === 0) { setMonthlyOpen(null); return; }
    const sessionId = ++monthlySession.current;
    let pending = changes.length;
    let hadError = false;
    const done = () => {
      pending--;
      if (pending === 0) {
        invalidateAll();
        if (monthlySession.current === sessionId) setMonthlyOpen(null);
        toast.show(hadError ? "Some months failed to save" : "Monthly amounts saved", { kind: hadError ? "error" : "success" });
      }
    };
    for (const c of changes) {
      if (isPlan) {
        upsertPlan.mutate({ id, data: { month: c.month, year: c.year, plannedAmount: c.amount } }, { onSuccess: done, onError: () => { hadError = true; done(); } });
      } else {
        upsertActual.mutate({ id, data: { month: c.month, year: c.year, actualAmount: c.amount } }, { onSuccess: done, onError: () => { hadError = true; done(); } });
      }
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError && !budgetLines) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ErrorState
          title="Failed to load budget lines"
          message="We couldn't fetch budget data. Check your connection and try again."
          onRetry={handleRefresh}
        />
      </View>
    );
  }

  const linesWithPct = (allLines || []).reduce<Record<number, number>>((acc, l) => { acc[l.id] = l.projectionPct ?? 0; return acc; }, {});

  const tableData: BudgetLineRow[] = (budgetLines || [])
    .filter((line) => !pendingDeleteIds.has(line.id))
    .map((line) => {
      const plans = (line.plans || []);
      const actuals = (line.actuals || []);
      const totalPlan = filterMonth > 0
        ? plans.filter(p => p.month === filterMonth).reduce((sum, p) => sum + (p.plannedAmount || 0), 0)
        : plans.reduce((sum, p) => sum + (p.plannedAmount || 0), 0);
      const totalActual = filterMonth > 0
        ? actuals.filter(a => a.month === filterMonth).reduce((sum, a) => sum + (a.actualAmount || 0), 0)
        : actuals.reduce((sum, a) => sum + (a.actualAmount || 0), 0);
      return {
        id: line.id,
        category: line.category,
        lineItem: line.lineItem,
        owner: line.owner ?? null,
        channel: (line as { channel?: string | null }).channel ?? null,
        costStatus: line.costStatus,
        totalPlan,
        totalActual,
        variance: totalPlan - totalActual,
        projectionPct: linesWithPct[line.id] ?? 0,
      };
    })
    .filter(d => filterCategory === "All" || d.category === filterCategory)
    .filter(d => !filterOwner || (d.owner ?? "") === filterOwner)
    .filter(d => filterChannel === "All" || (filterChannel === "none" ? !d.channel : d.channel === filterChannel));

  const sorted = useMemo(() => {
    if (!sortField || !sortDir) return tableData;
    const accessor = SORT_ACCESSORS[sortField];
    const arr = [...tableData];
    arr.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableData, sortField, sortDir]);

  const allCategories = [...new Set((budgetLines || []).map((d) => d.category))];
  const categories = [...new Set(sorted.map((d) => d.category))];
  const categoriesForPicker = (categoriesData && categoriesData.length > 0) ? categoriesData : allCategories;
  const owners = (ownersData ?? []) as { id: number; name: string; initials: string; color: string }[];

  const monthlyEntries = monthlyOpen
    ? (() => {
        const line = (budgetLines || []).find(l => l.id === monthlyOpen.id);
        if (!line) return [];
        if (monthlyOpen.mode === "plan") {
          return (line.plans || []).filter(p => p.year === FY_YEAR).map(p => ({ month: p.month, amount: p.plannedAmount }));
        }
        return (line.actuals || []).filter(a => a.year === FY_YEAR).map(a => ({ month: a.month, amount: a.actualAmount }));
      })()
    : [];

  const categoryOptions: PickerOption[] = categoriesForPicker.map((c) => ({ value: c, label: c }));
  const ownerOptions: PickerOption[] = [{ value: "", label: "— None —" }, ...owners.map((o) => ({ value: o.name, label: o.name, color: o.color }))];
  const channelOptions: PickerOption[] = [{ value: "", label: "— None —" }, ...CHANNEL_VALUES.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))];

  const content = (
    <View style={{ flex: 1 }}>
    <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.contentContainer, { paddingTop: isWeb ? 67 : 0, paddingBottom: isWeb ? 34 : 20, paddingHorizontal: isDesktop ? 32 : 16 }]}
      refreshControl={Platform.OS !== "web" ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} /> : undefined}
    >
      <SectionHeader title="Budget Lines" subtitle={`${sorted.length} line items across ${categories.length} categories`} />

      {filterOwner ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "40" }}>
            <Feather name="user" size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Owner: {filterOwner}</Text>
            <TouchableOpacity onPress={clearOwnerFilter} accessibilityLabel="Clear owner filter" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Feather name="x" size={12} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={[styles.filterBar, { borderColor: colors.border }]}>
        <View style={styles.filterGroup}>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Category</Text>
          <View style={[styles.filterPicker, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {["All", ...allCategories].map((cat) => (
              <TouchableOpacity key={cat} onPress={() => setFilterCategory(cat)} style={[styles.filterChip, filterCategory === cat && { backgroundColor: colors.primary }]}>
                <Text style={[styles.filterChipText, { color: filterCategory === cat ? "#fff" : colors.foreground }]} numberOfLines={1}>
                  {cat === "All" ? "All" : cat.length > 12 ? cat.slice(0, 12) + "\u2026" : cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.filterGroup}>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Channel</Text>
          <View style={[styles.filterPicker, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[{ v: "All", l: "All" }, { v: "none", l: "No channel" }, ...CHANNEL_VALUES.map((c) => ({ v: c, l: CHANNEL_LABELS[c] }))].map((opt) => (
              <TouchableOpacity key={opt.v} onPress={() => setFilterChannel(opt.v)} style={[styles.filterChip, filterChannel === opt.v && { backgroundColor: colors.primary }]}>
                <Text style={[styles.filterChipText, { color: filterChannel === opt.v ? "#fff" : colors.foreground }]} numberOfLines={1}>{opt.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Month</Text>
          <View style={[styles.filterPicker, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => setFilterMonth(0)} style={[styles.filterChip, filterMonth === 0 && { backgroundColor: colors.primary }]}>
              <Text style={[styles.filterChipText, { color: filterMonth === 0 ? "#fff" : colors.foreground }]}>All</Text>
            </TouchableOpacity>
            {MONTH_LABELS.map((m, i) => (
              <TouchableOpacity key={m} onPress={() => setFilterMonth(i + 1)} style={[styles.filterChip, filterMonth === i + 1 && { backgroundColor: colors.primary }]}>
                <Text style={[styles.filterChipText, { color: filterMonth === i + 1 ? "#fff" : colors.foreground }]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.segment}>
            <Text style={[styles.segmentLabel, { color: colors.mutedForeground }]}>Editing</Text>
            <TouchableOpacity onPress={() => setAmountMode("plan")} style={[styles.segmentBtn, amountMode === "plan" && { backgroundColor: colors.primary }]}>
              <Text style={[styles.segmentText, { color: amountMode === "plan" ? "#fff" : colors.foreground }]}>Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAmountMode("actual")} style={[styles.segmentBtn, amountMode === "actual" && { backgroundColor: colors.success }]}>
              <Text style={[styles.segmentText, { color: amountMode === "actual" ? "#fff" : colors.foreground }]}>Actual</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setAddOpen(true)} style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7}>
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Add line</Text>
          </TouchableOpacity>
        </View>
      </View>

      {sorted.length === 0 ? (
        <EmptyState icon="list" title="No budget lines" message="Tap 'Add line' to create your first budget line." />
      ) : isDesktop ? (
        <BudgetTable
          data={sorted}
          showProjection
          onProjectionChange={handleDesktopPctChange}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          categories={categoriesForPicker}
          owners={owners}
          amountColumnMode={amountMode}
          onUpdateField={handleUpdateField}
          onOpenMonthly={(id, lineItem, mode) => setMonthlyOpen({ id, lineItem, mode })}
          onDelete={handleDelete}
        />
      ) : (
        <View style={styles.mobileList}>
          {categories.map((cat) => {
            const catItems = sorted.filter((d) => d.category === cat);
            const catTotal = catItems.reduce((s, d) => s + d.totalPlan, 0);
            return (
              <View key={cat} style={styles.categoryGroup}>
                <View style={styles.categoryHeader}>
                  <Text style={[styles.categoryName, { color: colors.foreground }]}>{cat}</Text>
                  <Text style={[styles.categoryTotal, { color: colors.mutedForeground }]}>{formatCurrency(catTotal)}</Text>
                </View>
                {catItems.map((item) => {
                  const varianceColor = item.variance > 0 ? colors.success : item.variance < 0 ? colors.destructive : colors.foreground;
                  return (
                    <View key={item.id} style={[styles.mobileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                      <View style={styles.mobileCardTop}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <InlineText
                            value={item.lineItem}
                            onSave={(v) => handleUpdateField(item.id, "lineItem", v)}
                            colors={colors}
                            textStyle={{ fontSize: 14, fontFamily: "Inter_500Medium" }}
                          />
                        </View>
                        <TouchableOpacity onPress={() => confirmDelete(item.lineItem, () => handleDelete(item.id, item.lineItem))} hitSlop={8}>
                          <Feather name="trash-2" size={16} color={colors.destructive} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.mobileMetaRow}>
                        <PickerCell value={item.category} options={categoryOptions} onSelect={(v) => handleUpdateField(item.id, "category", v)} colors={colors} placeholder="Category" allowNew newLabel="+ New category…" onCreateNew={(v) => handleUpdateField(item.id, "category", v)} />
                        <PickerCell value={item.owner} options={ownerOptions} onSelect={(v) => handleUpdateField(item.id, "owner", v)} colors={colors} placeholder="Owner" withDots freeTextFallback />
                        <PickerCell value={item.channel} options={channelOptions} onSelect={(v) => handleUpdateField(item.id, "channel", v)} colors={colors} placeholder="Channel" />
                        <StatusBadge status={item.costStatus} onCycle={() => handleUpdateField(item.id, "costStatus", nextStatus(item.costStatus))} colors={colors} />
                        {item.channel && (
                          <View style={[styles.channelBadge, { backgroundColor: colors.primary + "22", borderColor: colors.primary }]}>
                            <Text style={[styles.channelBadgeText, { color: colors.primary }]}>{CHANNEL_LABELS[item.channel as ChannelValue] ?? item.channel}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.mobileCardBottom}>
                        {amountMode === "plan" ? (
                          <TouchableOpacity style={styles.mobileMetric} onPress={() => setMonthlyOpen({ id: item.id, lineItem: item.lineItem, mode: "plan" })} activeOpacity={0.6}>
                            <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Plan ✎</Text>
                            <Text style={[styles.mobileMetricValue, { color: colors.primary }]}>{formatCurrency(item.totalPlan)}</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.mobileMetric}>
                            <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Plan</Text>
                            <Text style={[styles.mobileMetricValue, { color: colors.foreground }]}>{formatCurrency(item.totalPlan)}</Text>
                          </View>
                        )}
                        {amountMode === "actual" ? (
                          <TouchableOpacity style={styles.mobileMetric} onPress={() => setMonthlyOpen({ id: item.id, lineItem: item.lineItem, mode: "actual" })} activeOpacity={0.6}>
                            <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Actual ✎</Text>
                            <Text style={[styles.mobileMetricValue, { color: colors.success }]}>{formatCurrency(item.totalActual)}</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.mobileMetric}>
                            <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Actual</Text>
                            <Text style={[styles.mobileMetricValue, { color: colors.foreground }]}>{formatCurrency(item.totalActual)}</Text>
                          </View>
                        )}
                        <View style={styles.mobileMetric}>
                          <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Variance</Text>
                          <Text style={[styles.mobileMetricValue, { color: varianceColor }]}>{formatCurrency(item.variance)}</Text>
                        </View>
                        <View style={styles.mobileMetric}>
                          <Text style={[styles.mobileMetricLabel, { color: colors.mutedForeground }]}>Var %</Text>
                          <Text style={[styles.mobileMetricValue, { color: varianceColor }]}>
                            {item.totalPlan > 0 ? ((item.variance / item.totalPlan) * 100).toFixed(1) + "%" : "-"}
                          </Text>
                        </View>
                      </View>
                      {item.costStatus === "Fixed Cost" && (
                        <TouchableOpacity onPress={() => setEditingLine({ id: item.id, lineItem: item.lineItem, pct: item.projectionPct ?? 0 })} style={[styles.projectionRow, { borderTopColor: colors.border }]} activeOpacity={0.7}>
                          <Feather name="trending-up" size={13} color={colors.primary} />
                          <Text style={[styles.projectionLabel, { color: colors.mutedForeground }]}>Projection</Text>
                          <Text style={[styles.projectionValue, { color: colors.primary }]}>{item.projectionPct}%</Text>
                          <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}

      {editingLine && (
        <ProjectionEditor
          lineId={editingLine.id}
          lineItem={editingLine.lineItem}
          currentPct={editingLine.pct}
          onClose={() => setEditingLine(null)}
          onSaved={() => { invalidateAll(); toast.show("Projection saved", { kind: "success" }); }}
          onError={() => toast.show("Failed to save projection", { kind: "error" })}
        />
      )}

      <AddLineModal
        visible={addOpen}
        categories={categoriesForPicker}
        owners={owners}
        saving={createMutation.isPending}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
      />

      <MonthlyAmountModal
        visible={!!monthlyOpen}
        title={monthlyOpen?.lineItem ?? ""}
        subtitle={monthlyOpen ? `12-month ${monthlyOpen.mode === "plan" ? "plan" : "actuals"} for FY${FY_YEAR}` : undefined}
        mode={monthlyOpen?.mode ?? "plan"}
        year={FY_YEAR}
        entries={monthlyEntries}
        saving={upsertPlan.isPending || upsertActual.isPending}
        onClose={() => setMonthlyOpen(null)}
        onSave={handleSaveMonthly}
      />
    </ScrollView>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(alerts || []).length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }
  return content;
}

export default function BudgetScreen() {
  return (
    <ToastProvider>
      <BudgetContent />
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  contentContainer: { gap: 12 },
  mobileList: { gap: 16 },
  categoryGroup: { gap: 8 },
  categoryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  categoryName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  categoryTotal: { fontSize: 13, fontFamily: "Inter_500Medium" },
  mobileCard: { borderWidth: 1, padding: 12 },
  mobileCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  mobileItemName: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, marginRight: 8 },
  mobileMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10 },
  mobileCardBottom: { flexDirection: "row", justifyContent: "space-between" },
  mobileMetric: { alignItems: "center" },
  mobileMetricLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
  mobileMetricValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  filterBar: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 4, alignItems: "flex-start" },
  filterGroup: { gap: 4, flex: 1, minWidth: 200 },
  filterLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  filterPicker: { flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 4, borderWidth: 1, borderRadius: 6 },
  filterChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  filterChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 8, borderRadius: 6, borderWidth: 1 },
  segment: { flexDirection: "row", alignItems: "center", gap: 4 },
  segmentLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase" as const, letterSpacing: 0.5, marginRight: 4 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  segmentText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  projectionRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, marginTop: 10, borderTopWidth: 1 },
  projectionLabel: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  projectionValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 12 },
  modalHandle: { alignItems: "center" },
  handleBar: { width: 36, height: 4, borderRadius: 2 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  modalInputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  modalInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontFamily: "Inter_500Medium", flex: 1 },
  modalPctSign: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  modalSaveButton: { paddingVertical: 12, borderRadius: 8, alignItems: "center", marginTop: 8 },
  modalSaveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  desktopContainer: { flex: 1, flexDirection: "row" },
  desktopContent: { flex: 1 },
  channelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  channelBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.3 },
});
