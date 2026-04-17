import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { AdminSubnav } from "@/components/AdminSubnav";
import { SectionHeader } from "@/components/SectionHeader";
import {
  useListSnapshots,
  useCreateSnapshot,
  useRestoreSnapshot,
  useDeleteSnapshot,
  getListSnapshotsQueryKey,
  type SnapshotMeta,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const fmt = (n: number) =>
  "£" + Math.round(n).toLocaleString("en-GB");

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function LabelBadge({ label }: { label: string }) {
  const colors = useColors();
  const isAuto = label.startsWith("auto-");
  const isPreRestore = label === "pre-restore";
  const isPreImport = label === "pre-import";

  let bg = colors.muted;
  let fg = colors.mutedForeground;
  if (isAuto) { bg = colors.primary + "20"; fg = colors.primary; }
  if (isPreRestore) { bg = "#7c3aed20"; fg = "#7c3aed"; }
  if (isPreImport) { bg = "#ea580c20"; fg = "#ea580c"; }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

interface SnapshotCardProps {
  snap: SnapshotMeta;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  restoring: boolean;
  deleting: boolean;
}

function SnapshotCard({ snap, onRestore, onDelete, restoring, deleting }: SnapshotCardProps) {
  const colors = useColors();
  const isProtected = snap.label === "pre-restore" || snap.label === "pre-import" || (!snap.label.startsWith("auto-") && snap.label !== "manual");
  const canDelete = !isProtected || snap.label === "manual";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Feather name="camera" size={14} color={colors.mutedForeground} />
          <Text style={[styles.cardDate, { color: colors.foreground }]} numberOfLines={1}>
            {fmtDate(snap.timestamp)}
          </Text>
        </View>
        <LabelBadge label={snap.label} />
      </View>

      <View style={styles.cardStats}>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Budget</Text>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Spent</Text>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{fmt(snap.totalSpent)}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Lines</Text>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{snap.lineCount}</Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary }]}
          onPress={() => onRestore(snap.id)}
          disabled={restoring || deleting}
          activeOpacity={0.8}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="rotate-ccw" size={12} color="#fff" />
              <Text style={styles.actionBtnText}>Restore</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.destructive ?? "#ef4444" }]}
          onPress={() => onDelete(snap.id)}
          disabled={restoring || deleting}
          activeOpacity={0.8}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="trash-2" size={12} color="#fff" />
              <Text style={styles.actionBtnText}>Delete</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.snapId, { color: colors.mutedForeground }]} numberOfLines={1}>
        ID: {snap.id}
      </Text>
    </View>
  );
}

export default function SnapshotsScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const qc = useQueryClient();

  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  const { data: snapshots = [], isLoading, refetch, isFetching } = useListSnapshots();

  const createSnap = useCreateSnapshot();
  const restoreSnap = useRestoreSnapshot();
  const deleteSnap = useDeleteSnapshot();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
  }, [qc]);

  const handleSave = useCallback(() => {
    const label = labelInput.trim() || "manual";
    setSavingId("saving");
    createSnap.mutate(
      { data: { label } },
      {
        onSuccess: () => {
          setShowSaveModal(false);
          setLabelInput("");
          invalidate();
        },
        onError: () => {
          Alert.alert("Error", "Failed to save snapshot.");
        },
        onSettled: () => setSavingId(null),
      }
    );
  }, [labelInput, createSnap, invalidate]);

  const handleRestore = useCallback((id: string) => {
    const confirmMsg = `Restore this snapshot? Current data will be overwritten. A pre-restore backup will be saved automatically.`;
    if (Platform.OS === "web") {
      if (!window.confirm(confirmMsg)) return;
      doRestore(id);
    } else {
      Alert.alert("Restore Snapshot", confirmMsg, [
        { text: "Cancel", style: "cancel" },
        { text: "Restore", style: "destructive", onPress: () => doRestore(id) },
      ]);
    }
  }, []);

  const doRestore = useCallback((id: string) => {
    setRestoringId(id);
    restoreSnap.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          Alert.alert("Restored", "Snapshot restored successfully. A pre-restore backup was saved.");
        },
        onError: () => {
          Alert.alert("Error", "Failed to restore snapshot.");
        },
        onSettled: () => setRestoringId(null),
      }
    );
  }, [restoreSnap, invalidate]);

  const handleDelete = useCallback((id: string) => {
    const confirmMsg = "Delete this snapshot? This cannot be undone.";
    if (Platform.OS === "web") {
      if (!window.confirm(confirmMsg)) return;
      doDelete(id);
    } else {
      Alert.alert("Delete Snapshot", confirmMsg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => doDelete(id) },
      ]);
    }
  }, []);

  const doDelete = useCallback((id: string) => {
    setDeletingId(id);
    deleteSnap.mutate(
      { id },
      {
        onSuccess: () => invalidate(),
        onError: () => Alert.alert("Error", "Failed to delete snapshot."),
        onSettled: () => setDeletingId(null),
      }
    );
  }, [deleteSnap, invalidate]);

  const content = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop]}
      refreshControl={
        <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
      }
    >
      <View style={[styles.inner, isDesktop && styles.innerDesktop]}>
        {isDesktop && <AdminSubnav active="snapshots" />}

        <SectionHeader
          icon="camera"
          title="Snapshots"
          subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} saved`}
        />

        <View style={styles.topBar}>
          <Text style={[styles.explainer, { color: colors.mutedForeground }]}>
            Snapshots capture the full budget state. Restore any snapshot to roll back all data.
          </Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={() => { setLabelInput(""); setShowSaveModal(true); }}
            activeOpacity={0.8}
          >
            <Feather name="camera" size={14} color="#fff" />
            <Text style={styles.saveBtnText}>Save Snapshot</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : snapshots.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <Feather name="camera" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No snapshots yet. Save one to get started.
            </Text>
          </View>
        ) : (
          <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
            {(snapshots as SnapshotMeta[]).map((snap) => (
              <SnapshotCard
                key={snap.id}
                snap={snap}
                onRestore={handleRestore}
                onDelete={handleDelete}
                restoring={restoringId === snap.id}
                deleting={deletingId === snap.id}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );

  const saveModal = (
    <Modal
      visible={showSaveModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowSaveModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Feather name="camera" size={18} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Save Snapshot</Text>
          </View>
          <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
            Enter an optional label (e.g. "before Q2 reforecast")
          </Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
            placeholder="manual"
            placeholderTextColor={colors.mutedForeground}
            value={labelInput}
            onChangeText={setLabelInput}
            autoFocus
            maxLength={40}
            onSubmitEditing={handleSave}
            returnKeyType="done"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.muted }]}
              onPress={() => setShowSaveModal(false)}
            >
              <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              disabled={savingId !== null}
            >
              {savingId ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <DesktopSidebar />
        <View style={{ flex: 1 }}>
          {content}
          {saveModal}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {content}
      {saveModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row" },
  scroll: { flexGrow: 1 },
  scrollDesktop: {},
  inner: { padding: 16, gap: 12 },
  innerDesktop: { padding: 24 },
  topBar: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  explainer: { flex: 1, fontSize: 13, lineHeight: 18, minWidth: 200 },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  grid: { gap: 12 },
  gridDesktop: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 10,
    minWidth: 280, flex: 1,
    ...(Platform.OS === "web" ? { maxWidth: 380 } : {}),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  cardDate: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  cardStats: { flexDirection: "row", gap: 16 },
  statItem: { gap: 2 },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardActions: { flexDirection: "row", gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, flex: 1, justifyContent: "center" },
  actionBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  snapId: { fontSize: 9, fontFamily: "Inter_400Regular" },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 40, alignItems: "center", gap: 12, marginTop: 20 },
  emptyText: { fontSize: 14, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalBox: { width: "100%", maxWidth: 440, borderRadius: 16, borderWidth: 1, padding: 24, gap: 14 },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, lineHeight: 18 },
  modalInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: "center" },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
