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

const fmt = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");

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

interface SnapshotRowProps {
  snap: SnapshotMeta;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function SnapshotRow({ snap, isSelected, onSelect }: SnapshotRowProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => onSelect(snap.id)}
      activeOpacity={0.7}
      style={[
        styles.row,
        {
          backgroundColor: isSelected ? colors.primary + "10" : colors.card,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
    >
      <View style={styles.rowLeft}>
        <Feather name="camera" size={14} color={isSelected ? colors.primary : colors.mutedForeground} />
        <View style={styles.rowMeta}>
          <Text style={[styles.rowDate, { color: colors.foreground }]}>{fmtDate(snap.timestamp)}</Text>
          <LabelBadge label={snap.label} />
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowBudget, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
        <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>{snap.lineCount} lines</Text>
      </View>
      <Feather name="chevron-right" size={14} color={isSelected ? colors.primary : colors.mutedForeground} />
    </TouchableOpacity>
  );
}

interface DetailPanelProps {
  snap: SnapshotMeta;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  restoring: boolean;
  deleting: boolean;
}

function DetailPanel({ snap, onRestore, onDelete, onClose, restoring, deleting }: DetailPanelProps) {
  const colors = useColors();
  const spent = snap.totalBudget > 0 ? (snap.totalSpent / snap.totalBudget) * 100 : 0;

  return (
    <View style={[styles.detail, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.detailHeader}>
        <Text style={[styles.detailTitle, { color: colors.foreground }]}>Snapshot Detail</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Saved</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmtDate(snap.timestamp)}</Text>
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Label</Text>
        <LabelBadge label={snap.label} />
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Budget Lines</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{snap.lineCount}</Text>
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Total Budget</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Total Spent</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmt(snap.totalSpent)}</Text>
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Utilisation</Text>
        <Text style={[styles.detailValue, { color: spent > 90 ? (colors.destructive ?? "#ef4444") : colors.foreground }]}>
          {spent.toFixed(1)}%
        </Text>
      </View>
      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Snapshot ID</Text>
        <Text style={[styles.detailId, { color: colors.mutedForeground }]} numberOfLines={2}>{snap.id}</Text>
      </View>

      <View style={styles.detailActions}>
        <TouchableOpacity
          style={[styles.detailBtn, { backgroundColor: colors.primary }]}
          onPress={() => onRestore(snap.id)}
          disabled={restoring || deleting}
          activeOpacity={0.8}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="rotate-ccw" size={13} color="#fff" />
              <Text style={styles.detailBtnText}>Restore This Snapshot</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.detailBtn, { backgroundColor: colors.destructive ?? "#ef4444" }]}
          onPress={() => onDelete(snap.id)}
          disabled={restoring || deleting}
          activeOpacity={0.8}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="trash-2" size={13} color="#fff" />
              <Text style={styles.detailBtnText}>Delete</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.detailWarning, { color: colors.mutedForeground }]}>
        Restoring will overwrite all current data. A pre-restore backup will be saved automatically.
      </Text>
    </View>
  );
}

export default function SnapshotsScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
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
        onError: () => Alert.alert("Error", "Failed to save snapshot."),
        onSettled: () => setSavingId(null),
      }
    );
  }, [labelInput, createSnap, invalidate]);

  const handleRestore = useCallback((id: string) => {
    const msg = "Restore this snapshot? Current data will be overwritten. A pre-restore backup will be saved automatically.";
    if (Platform.OS === "web") {
      if (!window.confirm(msg)) return;
      doRestore(id);
    } else {
      Alert.alert("Restore Snapshot", msg, [
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
          setSelectedId(null);
          Alert.alert("Restored", "Snapshot restored. A pre-restore backup was saved automatically.");
        },
        onError: () => Alert.alert("Error", "Failed to restore snapshot."),
        onSettled: () => setRestoringId(null),
      }
    );
  }, [restoreSnap, invalidate]);

  const handleDelete = useCallback((id: string) => {
    const msg = "Delete this snapshot? This cannot be undone.";
    if (Platform.OS === "web") {
      if (!window.confirm(msg)) return;
      doDelete(id);
    } else {
      Alert.alert("Delete Snapshot", msg, [
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
        onSuccess: () => {
          invalidate();
          if (selectedId === id) setSelectedId(null);
        },
        onError: () => Alert.alert("Error", "Failed to delete snapshot."),
        onSettled: () => setDeletingId(null),
      }
    );
  }, [deleteSnap, invalidate, selectedId]);

  const selectedSnap = selectedId ? (snapshots as SnapshotMeta[]).find((s) => s.id === selectedId) ?? null : null;

  const listContent = (
    <View style={styles.listPane}>
      <View style={styles.topBar}>
        <SectionHeader
          icon="camera"
          title="Snapshots"
          subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} saved`}
        />
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
          onPress={() => { setLabelInput(""); setShowSaveModal(true); }}
          activeOpacity={0.8}
        >
          <Feather name="camera" size={13} color="#fff" />
          <Text style={styles.saveBtnText}>Save Snapshot</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.explainer, { color: colors.mutedForeground }]}>
        Snapshots capture the full budget state. Tap a row to preview and restore.
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (snapshots as SnapshotMeta[]).length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Feather name="camera" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No snapshots yet. Save one to get started.
          </Text>
        </View>
      ) : (
        <View style={styles.rowList}>
          {(snapshots as SnapshotMeta[]).map((snap) => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              isSelected={selectedId === snap.id}
              onSelect={setSelectedId}
            />
          ))}
        </View>
      )}
    </View>
  );

  const detailContent = selectedSnap ? (
    <DetailPanel
      snap={selectedSnap}
      onRestore={handleRestore}
      onDelete={handleDelete}
      onClose={() => setSelectedId(null)}
      restoring={restoringId === selectedSnap.id}
      deleting={deletingId === selectedSnap.id}
    />
  ) : null;

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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.desktopScroll}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
        >
          <AdminSubnav active="snapshots" />
          <View style={styles.desktopSplit}>
            {listContent}
            {detailContent && (
              <View style={styles.detailPaneDesktop}>
                {detailContent}
              </View>
            )}
          </View>
        </ScrollView>
        {saveModal}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.mobileScroll}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
      >
        <AdminSubnav active="snapshots" />
        {listContent}
        {selectedSnap && (
          <View style={styles.detailPaneMobile}>
            {detailContent}
          </View>
        )}
      </ScrollView>
      {saveModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row" },
  desktopScroll: { padding: 24, gap: 12 },
  mobileScroll: { padding: 16, paddingBottom: 120, gap: 12 },
  desktopSplit: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  listPane: { flex: 1, gap: 12 },
  detailPaneDesktop: { width: 320 },
  detailPaneMobile: { marginTop: 4 },
  topBar: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  explainer: { fontSize: 13, lineHeight: 18 },
  rowList: { gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  rowLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  rowMeta: { gap: 4 },
  rowDate: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rowRight: { alignItems: "flex-end", gap: 2, marginRight: 4 },
  rowBudget: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowLines: { fontSize: 11 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 40, alignItems: "center", gap: 12 },
  emptyText: { fontSize: 14, textAlign: "center" },
  detail: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  detailSection: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  detailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  detailId: { fontSize: 10, fontFamily: "Inter_400Regular", maxWidth: 180, textAlign: "right" },
  detailActions: { gap: 8, marginTop: 4 },
  detailBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8 },
  detailBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  detailWarning: { fontSize: 11, lineHeight: 15, textAlign: "center" },
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
