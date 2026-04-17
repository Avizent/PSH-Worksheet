import React, { useState } from "react";
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
  useListCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useListAlerts,
  getListCategoriesQueryKey,
} from "@workspace/api-client-react";

type Category = {
  id: number;
  name: string;
  color: string;
  description?: string | null;
  lineCount: number;
};

const PRESET_COLORS = [
  "#1e3a5f", "#3d8fb8", "#d4a84b", "#16a34a",
  "#dc2626", "#d97706", "#7c3aed", "#db2777",
  "#0891b2", "#4d7c0f", "#6b7280", "#92400e",
];

export default function CategoriesScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: categoriesData, isLoading, refetch, isError } = useListCategories();
  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formDescription, setFormDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const categories = (categoriesData ?? []) as Category[];

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormColor(PRESET_COLORS[0]);
    setFormDescription("");
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setFormName(c.name);
    setFormColor(c.color);
    setFormDescription(c.description ?? "");
    setFormError(null);
    setShowForm(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
  };

  const submitForm = () => {
    const name = formName.trim();
    if (!name) { setFormError("Name is required"); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(formColor)) { setFormError("Pick a colour"); return; }
    const data = {
      name,
      color: formColor,
      description: formDescription.trim() || null,
    };
    const onSuccess = () => { invalidate(); setShowForm(false); };
    const onError = (e: unknown) => setFormError(e instanceof Error ? e.message : "Failed to save");

    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, { onSuccess, onError });
    } else {
      createMutation.mutate({ data }, { onSuccess, onError });
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { invalidate(); setDeleteTarget(null); },
    });
  };

  const goToBudgetForCategory = (c: Category) => {
    router.push({ pathname: "/budget", params: { category: c.name } });
  };

  const renderRow = ({ item: c }: { item: Category }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => goToBudgetForCategory(c)} style={styles.rowMain} activeOpacity={0.7}>
        <View style={[styles.colorDot, { backgroundColor: c.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowName, { color: colors.foreground }]}>{c.name}</Text>
          <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
            {c.lineCount} {c.lineCount === 1 ? "budget line" : "budget lines"}
            {c.description ? ` · ${c.description}` : ""}
          </Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: colors.primary + "15" }]}>
          <Text style={[styles.countBadgeText, { color: colors.primary }]}>{c.lineCount}</Text>
        </View>
      </TouchableOpacity>
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

  const ListHeader = (
    <View>
      {!isDesktop && <AdminSubnav active="categories" />}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <SectionHeader
            title="Categories"
            subtitle="Manage spending categories used across budget lines"
          />
        </View>
        <TouchableOpacity
          onPress={openCreate}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          accessibilityLabel="Add category"
          accessibilityRole="button"
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Add category</Text>
        </TouchableOpacity>
      </View>
      {!isLoading && !isError && categories.length > 0 && (
        <View style={[styles.infoBar, { backgroundColor: colors.primary + "0d", borderColor: colors.primary + "30" }]}>
          <Feather name="info" size={12} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            Renaming a category will automatically update all budget lines that use it.
          </Text>
        </View>
      )}
    </View>
  );

  const ListEmpty = isLoading ? (
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
  ) : isError ? (
    <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="alert-circle" size={28} color={colors.destructive} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Failed to load categories</Text>
      <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}>
        <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <EmptyState
      icon="tag"
      title="No categories yet"
      message="Add spending categories to organise your budget lines."
      actionLabel="Add category"
      onAction={openCreate}
    />
  );

  const content = (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
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
                {editing ? "Edit category" : "Add category"}
              </Text>
              <TouchableOpacity onPress={() => setShowForm(false)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
            <TextInput
              value={formName}
              onChangeText={setFormName}
              placeholder="e.g. Digital Marketing"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Description (optional)</Text>
            <TextInput
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder="Short description of this category"
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
                    style={[styles.colorSwatch, { backgroundColor: c, borderColor: selected ? colors.foreground : "transparent" }]}
                  >
                    {selected && <Feather name="check" size={14} color="#fff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.previewRow}>
              <View style={[styles.colorDot, { backgroundColor: formColor, width: 32, height: 32, borderRadius: 6 }]} />
              <Text style={[styles.previewLabel, { color: colors.foreground }]}>{formName || "Category name"}</Text>
            </View>

            {editing && (
              <View style={[styles.renameNote, { backgroundColor: colors.primary + "0d", borderColor: colors.primary + "30" }]}>
                <Feather name="refresh-cw" size={12} color={colors.primary} />
                <Text style={[styles.renameNoteText, { color: colors.primary }]}>
                  Renaming will update all budget lines that currently use "{editing.name}".
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
                    {editing ? "Save changes" : "Add category"}
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
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card, maxWidth: 400 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete category</Text>
              <TouchableOpacity onPress={() => setDeleteTarget(null)} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {deleteTarget && (
              <View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 }}>
                  Remove "{deleteTarget.name}" from the registry?
                </Text>
                {deleteTarget.lineCount > 0 ? (
                  <View style={[styles.warningBox, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "50" }]}>
                    <Feather name="alert-triangle" size={14} color={colors.warning} />
                    <Text style={{ color: colors.warning, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
                      {deleteTarget.lineCount} budget {deleteTarget.lineCount === 1 ? "line" : "lines"} still use this category.
                      Those lines will keep their existing category text — only the registry entry is removed.
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    No budget lines currently use this category.
                  </Text>
                )}
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
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, gap: 12,
  },
  rowMain: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  colorDot: { width: 20, height: 20, borderRadius: 6 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
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
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  previewLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  renameNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 12 },
  renameNoteText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
