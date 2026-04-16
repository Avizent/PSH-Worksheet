import React, { useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { AdminSubnav } from "@/components/AdminSubnav";
import {
  useListOwners,
  useCreateOwner,
  useUpdateOwner,
  useDeleteOwner,
  useListBudgetLines,
  useListAlerts,
  getListOwnersQueryKey,
  getListBudgetLinesQueryKey,
} from "@workspace/api-client-react";

type Owner = { id: number; name: string; initials: string; color: string };

const PRESET_COLORS = [
  "#1e3a5f", "#3d8fb8", "#d4a84b", "#16a34a",
  "#dc2626", "#d97706", "#7c3aed", "#db2777",
  "#0891b2", "#4d7c0f", "#6b7280", "#92400e",
];

function suggestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function OwnersScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: ownersData, isLoading, refetch, isError } = useListOwners();
  const { data: budgetLinesData, refetch: refetchBudgetLines } = useListBudgetLines();
  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const createMutation = useCreateOwner();
  const updateMutation = useUpdateOwner();
  const deleteMutation = useDeleteOwner();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Owner | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formInitials, setFormInitials] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Owner | null>(null);

  const owners = (ownersData ?? []) as Owner[];
  const budgetLines = budgetLinesData ?? [];

  const lineCountByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const bl of budgetLines) {
      const o = (bl.owner ?? "").trim();
      if (!o) continue;
      m.set(o, (m.get(o) ?? 0) + 1);
    }
    return m;
  }, [budgetLines]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchBudgetLines()]);
    setRefreshing(false);
  };

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormInitials("");
    setFormColor(PRESET_COLORS[0]);
    setInitialsTouched(false);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (o: Owner) => {
    setEditing(o);
    setFormName(o.name);
    setFormInitials(o.initials);
    setFormColor(o.color);
    setInitialsTouched(true);
    setFormError(null);
    setShowForm(true);
  };

  const onChangeName = (val: string) => {
    setFormName(val);
    if (!initialsTouched) {
      setFormInitials(suggestInitials(val));
    }
  };

  const onChangeInitials = (val: string) => {
    setInitialsTouched(true);
    setFormInitials(val.slice(0, 4).toUpperCase());
  };

  const submitForm = () => {
    const name = formName.trim();
    const initials = formInitials.trim().slice(0, 4).toUpperCase();
    if (!name) { setFormError("Name is required"); return; }
    if (!initials) { setFormError("Initials are required"); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(formColor)) { setFormError("Pick a colour"); return; }
    const data = { name, initials, color: formColor };
    const onSettled = () => {
      queryClient.invalidateQueries({ queryKey: getListOwnersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListBudgetLinesQueryKey() });
      setShowForm(false);
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: onSettled,
        onError: (e: unknown) => setFormError(e instanceof Error ? e.message : "Failed to save"),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: onSettled,
        onError: (e: unknown) => setFormError(e instanceof Error ? e.message : "Failed to save"),
      });
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOwnersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBudgetLinesQueryKey() });
        setDeleteTarget(null);
      },
    });
  };

  const goToBudgetForOwner = (o: Owner) => {
    router.push({ pathname: "/budget", params: { owner: o.name } });
  };

  const renderRow = ({ item: o }: { item: Owner }) => {
    const count = lineCountByName.get(o.name) ?? 0;
    return (
      <View style={[styles.ownerRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity onPress={() => goToBudgetForOwner(o)} style={styles.ownerMain} activeOpacity={0.7}>
          <View style={[styles.initialsChip, { backgroundColor: o.color }]}>
            <Text style={styles.initialsText}>{o.initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.ownerName, { color: colors.foreground }]}>{o.name}</Text>
            <Text style={[styles.ownerMeta, { color: colors.mutedForeground }]}>
              {count} {count === 1 ? "budget line" : "budget lines"}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={styles.ownerActions}>
          <TouchableOpacity
            onPress={() => openEdit(o)}
            style={[styles.iconBtn, { borderColor: colors.border }]}
            accessibilityLabel={`Edit ${o.name}`}
          >
            <Feather name="edit-2" size={14} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDeleteTarget(o)}
            style={[styles.iconBtn, { borderColor: colors.border }]}
            accessibilityLabel={`Delete ${o.name}`}
          >
            <Feather name="trash-2" size={14} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const ListHeader = (
    <View>
      {!isDesktop && <AdminSubnav active="owners" />}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <SectionHeader title="Owners" subtitle="Registry of people who can own budget lines" />
        </View>
        <TouchableOpacity
          onPress={openCreate}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          accessibilityLabel="Add owner"
          accessibilityRole="button"
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Add owner</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const ListEmpty = isLoading ? (
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
  ) : isError ? (
    <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="alert-circle" size={28} color={colors.destructive} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Failed to load owners</Text>
      <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}>
        <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <EmptyState
      icon="users"
      title="No owners yet"
      message="Add the first owner so budget lines can be assigned to a person."
      actionLabel="Add owner"
      onAction={openCreate}
    />
  );

  const content = (
    <View style={[styles.scroll, { backgroundColor: colors.background }]}>
      <FlatList
        data={owners}
        keyExtractor={(o) => String(o.id)}
        renderItem={renderRow}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      />

      {/* Add / Edit modal */}
      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalOverlay} onPress={() => setShowForm(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editing ? "Edit owner" : "Add owner"}
              </Text>
              <TouchableOpacity onPress={() => setShowForm(false)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
            <TextInput
              value={formName}
              onChangeText={onChangeName}
              placeholder="e.g. Patricia Hyde"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Initials (max 4)</Text>
            <TextInput
              value={formInitials}
              onChangeText={onChangeInitials}
              maxLength={4}
              autoCapitalize="characters"
              placeholder="PH"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Colour</Text>
            <View style={styles.colorRow}>
              {PRESET_COLORS.map((c) => {
                const selected = c.toLowerCase() === formColor.toLowerCase();
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setFormColor(c)}
                    accessibilityLabel={`Colour ${c}`}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: c, borderColor: selected ? colors.foreground : "transparent" },
                    ]}
                  >
                    {selected && <Feather name="check" size={14} color="#fff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.previewRow}>
              <View style={[styles.initialsChip, { backgroundColor: formColor }]}>
                <Text style={styles.initialsText}>{formInitials || "??"}</Text>
              </View>
              <Text style={[styles.previewText, { color: colors.mutedForeground }]}>Preview</Text>
            </View>

            {formError && (
              <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 8, fontFamily: "Inter_500Medium" }}>
                {formError}
              </Text>
            )}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => setShowForm(false)}
                style={[styles.btnSecondary, { borderColor: colors.border }]}
              >
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
                    {editing ? "Save changes" : "Add owner"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Delete confirm */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalOverlay} onPress={() => setDeleteTarget(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card, maxWidth: 380 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete owner</Text>
              <TouchableOpacity onPress={() => setDeleteTarget(null)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {deleteTarget && (() => {
              const refCount = lineCountByName.get(deleteTarget.name) ?? 0;
              return (
                <View>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 6 }}>
                    Remove “{deleteTarget.name}” from the registry?
                  </Text>
                  {refCount > 0 ? (
                    <View style={{ backgroundColor: colors.destructive + "15", padding: 10, borderRadius: 8, marginTop: 4 }}>
                      <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                        {refCount} budget {refCount === 1 ? "line" : "lines"} still list this owner by name. Those lines won't change automatically.
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      No budget lines reference this owner.
                    </Text>
                  )}
                </View>
              );
            })()}
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => setDeleteTarget(null)}
                style={[styles.btnSecondary, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
                style={[styles.btnPrimary, { backgroundColor: colors.destructive, opacity: deleteMutation.isPending ? 0.6 : 1 }]}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Delete</Text>
                )}
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
  scroll: { flex: 1 },
  desktopLayout: { flex: 1, flexDirection: "row" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 12 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  ownerMain: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  initialsChip: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  initialsText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 13 },
  ownerName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  ownerMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  ownerActions: { flexDirection: "row", gap: 6 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  emptyState: {
    alignItems: "center", padding: 40, borderRadius: 12, borderWidth: 1, gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center", padding: 16,
  },
  modalContent: {
    width: "100%", maxWidth: 460, borderRadius: 16, padding: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, marginTop: 10, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colorSwatch: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  previewText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnSecondary: {
    flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: "center",
  },
  btnPrimary: {
    flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center",
  },
});
