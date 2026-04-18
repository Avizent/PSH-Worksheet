import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
  FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { AdminSubnav } from "@/components/AdminSubnav";
import {
  useListBudgetLineColumns,
  useCreateBudgetLineColumn,
  useUpdateBudgetLineColumn,
  useDeleteBudgetLineColumn,
  useReorderBudgetLineColumns,
  useListAlerts,
  getListBudgetLineColumnsQueryKey,
} from "@workspace/api-client-react";

type Column = {
  id: number;
  name: string;
  type: "text" | "number";
  sortOrder: number;
};

type SortKey = "manual" | "name" | "type" | "created";
type SortDir = "asc" | "desc";

export default function ColumnsScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isError } = useListBudgetLineColumns();
  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const createMutation = useCreateBudgetLineColumn();
  const updateMutation = useUpdateBudgetLineColumn();
  const deleteMutation = useDeleteBudgetLineColumn();
  const reorderMutation = useReorderBudgetLineColumns();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Column | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"text" | "number">("text");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Column | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const columns = (data ?? []) as Column[];

  const sorted = useMemo(() => {
    const list = [...columns];
    if (sortKey === "manual") {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      return list;
    }
    const cmp = (a: Column, b: Column): number => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "type") return a.type.localeCompare(b.type);
      if (sortKey === "created") return a.id - b.id;
      return 0;
    };
    list.sort((a, b) => (sortDir === "asc" ? cmp(a, b) : -cmp(a, b)));
    return list;
  }, [columns, sortKey, sortDir]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListBudgetLineColumnsQueryKey() });
  };

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormType("text");
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (c: Column) => {
    setEditing(c);
    setFormName(c.name);
    setFormType(c.type);
    setFormError(null);
    setShowForm(true);
  };

  const submitForm = () => {
    const name = formName.trim();
    if (!name) { setFormError("Name is required"); return; }
    const onSuccess = () => { invalidate(); setShowForm(false); };
    const onError = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Failed to save";
      setFormError(msg.includes("409") ? "A column with that name already exists" : msg);
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { name, type: formType } }, { onSuccess, onError });
    } else {
      createMutation.mutate({ data: { name, type: formType } }, { onSuccess, onError });
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { invalidate(); setDeleteTarget(null); },
    });
  };

  const moveItem = (idx: number, direction: -1 | 1) => {
    if (sortKey !== "manual") return;
    const next = [...sorted];
    const target = idx + direction;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderMutation.mutate(
      { data: { ids: next.map((c) => c.id) } },
      { onSuccess: () => invalidate() },
    );
  };

  const cycleSort = (key: SortKey) => {
    if (key === "manual") {
      setSortKey("manual");
      return;
    }
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderRow = ({ item: c, index }: { item: Column; index: number }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {sortKey === "manual" && (
        <View style={styles.dragColumn}>
          <TouchableOpacity
            onPress={() => moveItem(index, -1)}
            disabled={index === 0 || reorderMutation.isPending}
            style={[styles.dragBtn, { borderColor: colors.border, opacity: index === 0 ? 0.3 : 1 }]}
            accessibilityLabel={`Move ${c.name} up`}
          >
            <Feather name="chevron-up" size={14} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => moveItem(index, 1)}
            disabled={index === sorted.length - 1 || reorderMutation.isPending}
            style={[styles.dragBtn, { borderColor: colors.border, opacity: index === sorted.length - 1 ? 0.3 : 1 }]}
            accessibilityLabel={`Move ${c.name} down`}
          >
            <Feather name="chevron-down" size={14} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, { color: colors.foreground }]}>{c.name}</Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
          {c.type === "number" ? "Number" : "Text"} · position {c.sortOrder + 1}
        </Text>
      </View>
      <View style={[styles.typeBadge, { backgroundColor: c.type === "number" ? colors.primary + "15" : colors.mutedForeground + "15" }]}>
        <Feather name={c.type === "number" ? "hash" : "type"} size={11} color={c.type === "number" ? colors.primary : colors.mutedForeground} />
        <Text style={[styles.typeBadgeText, { color: c.type === "number" ? colors.primary : colors.mutedForeground }]}>{c.type}</Text>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity
          onPress={() => openEdit(c)}
          style={[styles.iconBtn, { borderColor: colors.border }]}
          accessibilityLabel={`Edit ${c.name}`}
        >
          <Feather name="edit-2" size={14} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setDeleteTarget(c)}
          style={[styles.iconBtn, { borderColor: colors.border }]}
          accessibilityLabel={`Delete ${c.name}`}
        >
          <Feather name="trash-2" size={14} color={colors.destructive} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const SortChip = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortKey === k;
    const arrow = active && k !== "manual" ? (sortDir === "asc" ? "↑" : "↓") : "";
    return (
      <TouchableOpacity
        onPress={() => cycleSort(k)}
        style={[
          styles.sortChip,
          {
            backgroundColor: active ? colors.primary + "15" : colors.card,
            borderColor: active ? colors.primary : colors.border,
          },
        ]}
      >
        <Text style={{
          fontSize: 12,
          fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
          color: active ? colors.primary : colors.foreground,
        }}>
          {label} {arrow}
        </Text>
      </TouchableOpacity>
    );
  };

  const ListHeader = (
    <View>
      {!isDesktop && <AdminSubnav active="columns" />}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <SectionHeader
            title="Custom Columns"
            subtitle="Add fields that appear on every budget line"
          />
        </View>
        <TouchableOpacity
          onPress={openCreate}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          accessibilityLabel="Add column"
          accessibilityRole="button"
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Add column</Text>
        </TouchableOpacity>
      </View>

      {!isLoading && !isError && columns.length > 0 && (
        <View style={[styles.infoBar, { backgroundColor: colors.primary + "0d", borderColor: colors.primary + "30" }]}>
          <Feather name="info" size={12} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            Renaming a column preserves data already entered. Deleting a column also clears its values from every budget line.
          </Text>
        </View>
      )}

      {columns.length > 0 && (
        <View style={styles.sortRow}>
          <Text style={[styles.sortLabel, { color: colors.mutedForeground }]}>Sort:</Text>
          <SortChip k="manual" label="Manual" />
          <SortChip k="name" label="Name" />
          <SortChip k="type" label="Type" />
          <SortChip k="created" label="Created" />
        </View>
      )}
    </View>
  );

  const ListEmpty = isLoading ? (
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
  ) : isError ? (
    <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="alert-circle" size={28} color={colors.destructive} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Failed to load columns</Text>
      <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}>
        <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <EmptyState
      icon="columns"
      title="No custom columns yet"
      message="Add a column to capture extra information against each budget line (e.g. Vendor, PO number, Notes)."
      actionLabel="Add column"
      onAction={openCreate}
    />
  );

  const content = (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <FlatList
        data={sorted}
        keyExtractor={(c) => String(c.id)}
        renderItem={renderRow}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      />

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalOverlay} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editing ? "Edit column" : "Add column"}
              </Text>
              <TouchableOpacity onPress={() => setShowForm(false)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Column name</Text>
            <TextInput
              value={formName}
              onChangeText={setFormName}
              placeholder="e.g. Vendor"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
            <View style={styles.typeRow}>
              {(["text", "number"] as const).map((t) => {
                const active = formType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setFormType(t)}
                    style={[
                      styles.typeOption,
                      {
                        backgroundColor: active ? colors.primary + "15" : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Feather name={t === "number" ? "hash" : "type"} size={14} color={active ? colors.primary : colors.foreground} />
                    <Text style={{
                      fontSize: 13,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
                      color: active ? colors.primary : colors.foreground,
                    }}>{t === "number" ? "Number" : "Text"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {editing && (
              <View style={[styles.renameNote, { backgroundColor: colors.primary + "0d", borderColor: colors.primary + "30" }]}>
                <Feather name="refresh-cw" size={12} color={colors.primary} />
                <Text style={[styles.renameNoteText, { color: colors.primary }]}>
                  Renaming preserves existing values stored under "{editing.name}".
                </Text>
              </View>
            )}

            {formError && (
              <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 8, fontFamily: "Inter_500Medium" }}>
                {formError}
              </Text>
            )}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={[styles.btnSecondary, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                style={[styles.btnPrimary, { backgroundColor: colors.primary, opacity: (createMutation.isPending || updateMutation.isPending) ? 0.6 : 1 }]}
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {editing ? "Save changes" : "Add column"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalOverlay} onPress={() => setDeleteTarget(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card, maxWidth: 400 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete column</Text>
              <TouchableOpacity onPress={() => setDeleteTarget(null)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {deleteTarget && (
              <View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 }}>
                  Delete "{deleteTarget.name}"?
                </Text>
                <View style={[styles.warningBox, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "50" }]}>
                  <Feather name="alert-triangle" size={14} color={colors.warning} />
                  <Text style={{ color: colors.warning, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
                    Any value previously stored in this column on any budget line will be removed. This cannot be undone.
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={() => setDeleteTarget(null)} style={[styles.btnSecondary, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
                style={[styles.btnPrimary, { backgroundColor: colors.destructive, opacity: deleteMutation.isPending ? 0.6 : 1 }]}
              >
                {deleteMutation.isPending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Delete</Text>
                }
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopLayout, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={alertCount} />
        <View style={{ flex: 1 }}>{content}</View>
      </View>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  desktopLayout: { flex: 1, flexDirection: "row" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 12 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  infoBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  infoText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  sortLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, textTransform: "uppercase", marginRight: 4 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, gap: 12,
  },
  dragColumn: { gap: 4 },
  dragBtn: { width: 26, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
  rowActions: { flexDirection: "row", gap: 6 },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  emptyState: { alignItems: "center", padding: 40, borderRadius: 12, borderWidth: 1, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 16 },
  modalContent: { width: "100%", maxWidth: 460, borderRadius: 16, padding: 20 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, marginTop: 10, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  typeRow: { flexDirection: "row", gap: 8 },
  typeOption: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 8, borderWidth: 1,
  },
  renameNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 12 },
  renameNoteText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
