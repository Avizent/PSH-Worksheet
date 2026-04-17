import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { AdminSubnav } from "@/components/AdminSubnav";
import { SectionHeader } from "@/components/SectionHeader";
import { useToast } from "@/contexts/ToastContext";
import {
  useListSnapshots,
  useCreateSnapshot,
  useRestoreSnapshot,
  useDeleteSnapshot,
  useCompareSnapshots,
  usePinSnapshot,
  useImportSnapshot,
  useRenameSnapshot,
  getListSnapshotsQueryKey,
  type SnapshotMeta,
  type SnapshotDiff,
  type SnapshotDiffLine,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/utils/getApiUrl";

const PROTECTED_LABELS = ["pre-import", "pre-restore"];

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function SnapshotsScreen() {
  const colors = useColors();
  const { isDesktop } = useLayout();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [saveLabel, setSaveLabel] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  const renameMutation = useRenameSnapshot();

  const { data: snapshots = [], isLoading, refetch, isFetching } = useListSnapshots();

  const createMutation = useCreateSnapshot();
  const restoreMutation = useRestoreSnapshot();
  const deleteMutation = useDeleteSnapshot();
  const pinSnap = usePinSnapshot();
  const importMutation = useImportSnapshot();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });

  const handleSave = async () => {
    setSavingId("saving");
    try {
      const label = saveLabel.trim() || "manual";
      await createMutation.mutateAsync({ label });
      showToast(`Snapshot "${label}" saved.`);
      setSaveLabel("");
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
    } catch {
      showToast("Failed to save snapshot.", "error");
    } finally {
      setSavingId(null);
    }
  };

  const openRestoreModal = (snap: SnapshotMeta) => {
    setRestoreTarget(snap);
    setConfirmText("");
  };

  const handleRestore = async () => {
    if (!restoreTarget || confirmText !== "CONFIRM") return;
    setRestoring(true);
    try {
      await restoreMutation.mutateAsync(restoreTarget.id);
      showToast(`Restored from "${restoreTarget.label}" snapshot.`);
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
      setRestoreTarget(null);
      setConfirmText("");
      setSelectedId(null);
    } catch {
      showToast("Restore failed. Check the server logs.", "error");
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = (snap: SnapshotMeta) => {
    if (PROTECTED_LABELS.includes(snap.label)) {
      showToast("This snapshot is protected and cannot be deleted.", "error");
      return;
    }
    const doDelete = () => {
      setDeletingId(snap.id);
      deleteMutation.mutate(
        { id: snap.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
            showToast("Snapshot deleted.");
            if (selectedId === snap.id) setSelectedId(null);
          },
          onError: () => showToast("Failed to delete snapshot.", "error"),
          onSettled: () => setDeletingId(null),
        },
      );
    };
    const message = snap.pinned
      ? `This snapshot is pinned — are you sure you want to delete it? This cannot be undone.`
      : `Delete snapshot "${snap.label}"? This cannot be undone.`;
    if (Platform.OS === "web") {
      if (window.confirm(message)) doDelete();
    } else {
      Alert.alert(
        snap.pinned ? "Delete Pinned Snapshot?" : `Delete Snapshot?`,
        message,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ]
      );
    }
  };

  const handleToggleCompare = useCallback(() => {
    if (compareMode) {
      setCompareMode(false);
      setCompareA(null);
      setCompareB(null);
      setShowCompare(false);
    } else {
      setCompareMode(true);
      setSelectedId(null);
    }
  }, [compareMode]);

  const handleCompareSelect = useCallback((id: string) => {
    if (compareA === id) {
      setCompareA(compareB);
      setCompareB(null);
      setShowCompare(false);
      return;
    }
    if (compareB === id) {
      setCompareB(null);
      setShowCompare(false);
      return;
    }
    if (!compareA) {
      setCompareA(id);
      return;
    }
    if (!compareB) {
      setCompareB(id);
      setShowCompare(true);
      return;
    }
    setCompareA(id);
    setCompareB(null);
    setShowCompare(false);
  }, [compareA, compareB]);

  const handleRowSelect = useCallback((id: string) => {
    if (compareMode) {
      handleCompareSelect(id);
    } else {
      setSelectedId((prev) => (prev === id ? null : id));
    }
  }, [compareMode, handleCompareSelect]);

  const handleDownload = useCallback(async (id: string) => {
    setDownloadingId(id);
    try {
      const url = `${getApiUrl()}/api/snapshots/${encodeURIComponent(id)}`;
      if (Platform.OS === "web") {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Download failed");
        const json = await res.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `${id}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(href);
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Download failed");
        const json = await res.json();
        const fileUri = `${FileSystem.cacheDirectory}${id}.json`;
        await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(json, null, 2), {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/json",
            dialogTitle: "Save snapshot backup",
            UTI: "public.json",
          });
        } else {
          Alert.alert("Error", "Sharing is not available on this device.");
        }
      }
    } catch {
      Alert.alert("Error", "Failed to download snapshot.");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const handlePin = useCallback((id: string, pinned: boolean) => {
    setPinningId(id);
    pinSnap.mutate(
      { id, data: { pinned } },
      {
        onSuccess: () => invalidate(),
        onError: () => Alert.alert("Error", "Failed to update pin state."),
        onSettled: () => setPinningId(null),
      }
    );
  }, [pinSnap, invalidate]);

  const handleImport = useCallback(async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        let json: Record<string, unknown>;
        try {
          const text = await file.text();
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          showToast("Invalid JSON file.", "error");
          return;
        }
        try {
          await importMutation.mutateAsync(json);
          showToast("Snapshot imported successfully.");
        } catch {
          showToast("Failed to import. Make sure the file is a valid snapshot backup.", "error");
        }
      };
      input.click();
    } else {
      try {
        const result = await DocumentPicker.getDocumentAsync({ type: "application/json" });
        if (result.canceled) return;
        const fileUri = result.assets[0].uri;
        let json: Record<string, unknown>;
        try {
          const text = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          Alert.alert("Error", "Invalid JSON file.");
          return;
        }
        await importMutation.mutateAsync(json);
        showToast("Snapshot imported successfully.");
      } catch {
        Alert.alert("Error", "Failed to import. Make sure the file is a valid snapshot backup.");
      }
    }
  }, [importMutation, showToast]);

  const selectedSnap = selectedId ? (snapshots as SnapshotMeta[]).find((s) => s.id === selectedId) ?? null : null;

  const listContent = (
    <View style={styles.listPane}>
      <View style={styles.topBar}>
        <SectionHeader
          icon="camera"
          title="Snapshots"
          subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} saved`}
        />
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={[
              styles.compareBtn,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                opacity: importMutation.isPending ? 0.6 : 1,
              },
            ]}
            onPress={handleImport}
            disabled={importMutation.isPending}
            activeOpacity={0.8}
          >
            {importMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <Feather name="upload" size={13} color={colors.foreground} />
                <Text style={[styles.compareBtnText, { color: colors.foreground }]}>Import from file</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.compareBtn,
              {
                backgroundColor: compareMode ? colors.primary : colors.muted,
                borderColor: compareMode ? colors.primary : colors.border,
              },
            ]}
            onPress={handleToggleCompare}
            activeOpacity={0.8}
          >
            <Feather name="git-merge" size={13} color={compareMode ? "#fff" : colors.foreground} />
            <Text style={[styles.compareBtnText, { color: compareMode ? "#fff" : colors.foreground }]}>
              {compareMode ? "Exit Compare" : "Compare"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Save panel */}
      <View style={[styles.savePanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.savePanelHeader}>
          <Feather name="save" size={16} color={colors.primary} />
          <Text style={[styles.savePanelTitle, { color: colors.foreground }]}>Save New Snapshot</Text>
        </View>
        <Text style={[styles.savePanelSubtext, { color: colors.mutedForeground }]}>
          Captures all budget lines, monthly plans, and actuals at this moment.
        </Text>
        <View style={styles.saveRow}>
          <TextInput
            style={[styles.labelInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Label (optional, e.g. before-q2-update)"
            placeholderTextColor={colors.mutedForeground}
            value={saveLabel}
            onChangeText={setSaveLabel}
            maxLength={40}
          />
          <TouchableOpacity
            onPress={handleSave}
            disabled={!!savingId || createMutation.isPending}
            style={[styles.saveButton, { backgroundColor: colors.primary, opacity: savingId || createMutation.isPending ? 0.6 : 1 }]}
            activeOpacity={0.8}
          >
            {savingId || createMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="camera" size={14} color="#fff" />
                <Text style={styles.saveButtonText}>Save Snapshot</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {compareMode ? (
        <View style={[styles.compareHint, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "40" }]}>
          <Feather name="info" size={13} color={colors.primary} />
          <Text style={[styles.compareHintText, { color: colors.primary }]}>
            {!compareA
              ? "Tap a snapshot to select it as A (before)"
              : !compareB
              ? "Now tap another snapshot to select it as B (after)"
              : "Both selected — view the diff below, or tap a snapshot to change the selection"}
          </Text>
        </View>
      ) : (
        <Text style={[styles.explainer, { color: colors.mutedForeground }]}>
          Snapshots capture the full budget state. Tap a row to preview and restore.
        </Text>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (snapshots as SnapshotMeta[]).length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Feather name="camera" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No snapshots yet. Save one to get started.
          </Text>
        </View>
      ) : (() => {
        const allSnaps = snapshots as SnapshotMeta[];
        const pinned = allSnaps.filter((s) => s.pinned);
        const recent = allSnaps.filter((s) => !s.pinned);
        const renderRow = (snap: SnapshotMeta) => (
          <SnapshotRow
            key={snap.id}
            snap={snap}
            isSelected={!compareMode && selectedId === snap.id}
            isDownloading={downloadingId === snap.id}
            onSelect={handleRowSelect}
            onDownload={handleDownload}
            compareSlot={compareA === snap.id ? "A" : compareB === snap.id ? "B" : null}
            compareMode={compareMode}
            onPin={handlePin}
            pinning={pinningId === snap.id}
          />
        );
        return (
          <View style={styles.rowList}>
            {pinned.length > 0 && (
              <>
                <View style={[styles.groupHeader, { borderBottomColor: colors.border }]}>
                  <Feather name="bookmark" size={12} color={colors.primary} />
                  <Text style={[styles.groupHeaderText, { color: colors.primary }]}>Pinned</Text>
                </View>
                {pinned.map(renderRow)}
              </>
            )}
            {recent.length > 0 && (
              <>
                <View style={[styles.groupHeader, { borderBottomColor: colors.border, marginTop: pinned.length > 0 ? 16 : 0 }]}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.groupHeaderText, { color: colors.mutedForeground }]}>Recent</Text>
                </View>
                {recent.map(renderRow)}
              </>
            )}
          </View>
        );
      })()}
    </View>
  );

  const detailContent = selectedSnap ? (
    <DetailPanel
      snap={selectedSnap}
      onRestore={() => openRestoreModal(selectedSnap)}
      onDelete={() => handleDelete(selectedSnap)}
      onDownload={handleDownload}
      onPin={handlePin}
      onClose={() => setSelectedId(null)}
      onRename={async (newLabel: string) => {
        try {
          await renameMutation.mutateAsync({ id: selectedSnap.id, label: newLabel });
          queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
          showToast(`Renamed to "${newLabel}".`);
        } catch {
          showToast("Failed to rename snapshot.", "error");
          throw new Error("rename failed");
        }
      }}
      restoring={restoring && restoreTarget?.id === selectedSnap.id}
      deleting={deletingId === selectedSnap.id}
      downloading={downloadingId === selectedSnap.id}
      pinning={pinningId === selectedSnap.id}
      renaming={renameMutation.isPending}
    />
  ) : null;

  const compareContent =
    compareMode && showCompare && compareA && compareB ? (
      <ComparePanel
        aId={compareA}
        bId={compareB}
        snapshots={snapshots as SnapshotMeta[]}
        onClose={() => { setShowCompare(false); setCompareA(null); setCompareB(null); }}
      />
    ) : null;

  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <DesktopSidebar />
        <View style={styles.desktopContent}>
          <View style={styles.desktopMain}>
            <View style={styles.splitView}>
              {listContent}
              <View style={[styles.detailPane, { borderLeftColor: colors.border }]}>
                {compareMode ? compareContent : detailContent || (
                  <View style={styles.noSelection}>
                    <Feather name="mouse-pointer" size={24} color={colors.mutedForeground} />
                    <Text style={[styles.noSelectionText, { color: colors.mutedForeground }]}>
                      Select a snapshot to see details
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Restore confirm modal (Desktop) */}
        <Modal
          visible={!!restoreTarget}
          transparent
          animationType="fade"
          onRequestClose={() => { setRestoreTarget(null); setConfirmText(""); }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: "#f59e0b" }]}>
              <View style={styles.modalWarningStrip}>
                <Feather name="alert-triangle" size={18} color="#f59e0b" />
                <Text style={styles.modalWarningText}>Warning — Destructive Action</Text>
              </View>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Restore Snapshot</Text>
              {restoreTarget && (
                <>
                  <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                    This will <Text style={{ color: "#dc2626", fontFamily: "Inter_600SemiBold" }}>replace all current budget data</Text> with the state from:
                  </Text>
                  <View style={[styles.snapPreview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <LabelBadge label={restoreTarget.label} />
                    <Text style={[styles.snapPreviewDate, { color: colors.foreground }]}>
                      {formatDate(restoreTarget.createdAt)}
                    </Text>
                  </View>
                  <Text style={[styles.confirmInstruction, { color: colors.foreground }]}>
                    To proceed, type <Text style={{ fontFamily: "Inter_700Bold" }}>CONFIRM</Text> below:
                  </Text>
                  <TextInput
                    style={[styles.confirmInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    value={confirmText}
                    onChangeText={setConfirmText}
                    autoCapitalize="characters"
                    placeholder="Type CONFIRM"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      onPress={() => { setRestoreTarget(null); setConfirmText(""); }}
                      style={[styles.modalButton, { backgroundColor: colors.muted }]}
                    >
                      <Text style={[styles.modalButtonText, { color: colors.foreground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleRestore}
                      disabled={confirmText !== "CONFIRM" || restoring}
                      style={[
                        styles.modalButton,
                        { backgroundColor: "#f59e0b", opacity: confirmText !== "CONFIRM" || restoring ? 0.5 : 1 }
                      ]}
                    >
                      {restoring ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.modalButtonText}>Restore Now</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        <AdminSubnav active="snapshots" />
        {listContent}
      </ScrollView>

      {/* Mobile Details Modal */}
      <Modal
        visible={!!selectedId && !compareMode}
        animationType="slide"
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={[styles.mobileModal, { backgroundColor: colors.background }]}>
          <View style={[styles.mobileModalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.mobileModalTitle, { color: colors.foreground }]}>Snapshot Details</Text>
            <TouchableOpacity onPress={() => setSelectedId(null)}>
              <Feather name="x" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          {detailContent}
        </View>
      </Modal>

      {/* Mobile Compare Modal */}
      <Modal
        visible={showCompare && compareMode}
        animationType="slide"
        onRequestClose={() => setShowCompare(false)}
      >
        <View style={[styles.mobileModal, { backgroundColor: colors.background }]}>
          <View style={[styles.mobileModalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.mobileModalTitle, { color: colors.foreground }]}>Comparison Diff</Text>
            <TouchableOpacity onPress={() => setShowCompare(false)}>
              <Feather name="x" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          {compareContent}
        </View>
      </Modal>

      {/* Restore confirm modal (Mobile) */}
      <Modal
        visible={!!restoreTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { setRestoreTarget(null); setConfirmText(""); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: "#f59e0b" }]}>
            <View style={styles.modalWarningStrip}>
              <Feather name="alert-triangle" size={18} color="#f59e0b" />
              <Text style={styles.modalWarningText}>Warning — Destructive Action</Text>
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Restore Snapshot</Text>
            {restoreTarget && (
              <>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  This will <Text style={{ color: "#dc2626", fontFamily: "Inter_600SemiBold" }}>replace all current budget data</Text> with the state from:
                </Text>
                <View style={[styles.snapPreview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <LabelBadge label={restoreTarget.label} />
                  <Text style={[styles.snapPreviewDate, { color: colors.foreground }]}>
                    {formatDate(restoreTarget.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.confirmInstruction, { color: colors.foreground }]}>
                  To proceed, type <Text style={{ fontFamily: "Inter_700Bold" }}>CONFIRM</Text> below:
                </Text>
                <TextInput
                  style={[styles.confirmInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={confirmText}
                  onChangeText={setConfirmText}
                  autoCapitalize="characters"
                  placeholder="Type CONFIRM"
                  placeholderTextColor={colors.mutedForeground}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    onPress={() => { setRestoreTarget(null); setConfirmText(""); }}
                    style={[styles.modalButton, { backgroundColor: colors.muted }]}
                  >
                    <Text style={[styles.modalButtonText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleRestore}
                    disabled={confirmText !== "CONFIRM" || restoring}
                    style={[
                      styles.modalButton,
                      { backgroundColor: "#f59e0b", opacity: confirmText !== "CONFIRM" || restoring ? 0.5 : 1 }
                    ]}
                  >
                    {restoring ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.modalButtonText}>Restore Now</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  "pre-import": { bg: "#f59e0b20", text: "#b45309" },
  "pre-restore": { bg: "#f59e0b20", text: "#b45309" },
  "auto-open": { bg: "#3b82f620", text: "#1d4ed8" },
  "auto-close": { bg: "#3b82f620", text: "#1d4ed8" },
  manual: { bg: "#6b728020", text: "#374151" },
};

function LabelBadge({ label }: { label: string }) {
  const c = LABEL_COLORS[label] ?? { bg: "#10b98120", text: "#065f46" };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{label}</Text>
    </View>
  );
}

function SnapshotRow({
  snap,
  isSelected,
  isDownloading,
  onSelect,
  onDownload,
  compareSlot,
  onPin,
  pinning,
}: {
  snap: SnapshotMeta;
  isSelected: boolean;
  isDownloading: boolean;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  compareSlot: "A" | "B" | null;
  compareMode?: boolean;
  onPin: (id: string, pinned: boolean) => void;
  pinning: boolean;
}) {
  const colors = useColors();
  const fmt = (v: number) => "£" + Math.round(v).toLocaleString("en-GB");
  const bg = isSelected
    ? colors.primary + "15"
    : compareSlot === "A"
    ? "#3b82f615"
    : compareSlot === "B"
    ? "#10b98115"
    : colors.card;

  return (
    <TouchableOpacity
      onPress={() => onSelect(snap.id)}
      activeOpacity={0.8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        backgroundColor: bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 8,
      }}
    >
      <TouchableOpacity
        style={styles.pinBtn}
        onPress={() => onPin(snap.id, !snap.pinned)}
        disabled={pinning}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather
          name="bookmark"
          size={14}
          color={snap.pinned ? colors.primary : colors.mutedForeground}
        />
      </TouchableOpacity>

      <View style={styles.rowLeft}>
        <View style={styles.rowMeta}>
          <View style={styles.rowBadgeRow}>
            <LabelBadge label={snap.label} />
            {snap.pinned && (
              <View style={[styles.badge, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.badgeText, { color: colors.primary }]}>pinned</Text>
              </View>
            )}
            {compareSlot && (
              <View
                style={[
                  styles.slotBadge,
                  { backgroundColor: compareSlot === "A" ? "#3b82f6" : "#10b981" },
                ]}
              >
                <Text style={styles.slotBadgeText}>{compareSlot}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowDate, { color: colors.mutedForeground }]}>
            {formatDate(snap.createdAt)}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        {snap.totalBudget !== undefined && (
          <Text style={[styles.rowBudget, { color: colors.foreground }]}>
            {fmt(snap.totalBudget)}
          </Text>
        )}
        {snap.lineCount !== undefined && (
          <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>
            {snap.lineCount} line{snap.lineCount !== 1 ? "s" : ""}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.rowDownloadBtn}
        onPress={() => onDownload(snap.id)}
        disabled={isDownloading}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {isDownloading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="download" size={14} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function DetailPanel({
  snap,
  onRestore,
  onDelete,
  onDownload,
  onPin,
  onClose,
  onRename,
  restoring,
  deleting,
  downloading,
  pinning,
  renaming,
}: {
  snap: SnapshotMeta;
  onRestore: () => void;
  onDelete: () => void;
  onDownload: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onClose: () => void;
  onRename: (newLabel: string) => Promise<void>;
  restoring: boolean;
  deleting: boolean;
  downloading: boolean;
  pinning: boolean;
  renaming: boolean;
}) {
  const colors = useColors();
  const [editMode, setEditMode] = useState(false);
  const [editLabel, setEditLabel] = useState(snap.label);
  const fmt = (v: number) => "£" + Math.round(v).toLocaleString("en-GB");
  const isProtected = ["pre-import", "pre-restore"].includes(snap.label);

  const handleSaveRename = async () => {
    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === snap.label) {
      setEditMode(false);
      return;
    }
    try {
      await onRename(trimmed);
      setEditMode(false);
    } catch {
      // Keep edit mode open so the user can retry or cancel
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.detail, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.detailHeader}>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>Snapshot Details</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Label</Text>
          {editMode ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.primary,
                    color: colors.foreground,
                    flex: 1,
                    maxWidth: 180,
                    paddingVertical: 4,
                  },
                ]}
                value={editLabel}
                onChangeText={setEditLabel}
                maxLength={40}
                autoFocus
                onSubmitEditing={handleSaveRename}
                returnKeyType="done"
              />
              <TouchableOpacity
                onPress={handleSaveRename}
                disabled={renaming || !editLabel.trim()}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: renaming ? 0.6 : 1, paddingHorizontal: 10, paddingVertical: 6 }]}
              >
                {renaming ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff", fontSize: 12 }]}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setEditMode(false); setEditLabel(snap.label); }}
                style={[styles.modalBtn, { backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 6 }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground, fontSize: 12 }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LabelBadge label={snap.label} />
              {!isProtected && (
                <TouchableOpacity
                  onPress={() => { setEditMode(true); setEditLabel(snap.label); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Created</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>{formatDate(snap.createdAt)}</Text>
        </View>

        {snap.totalBudget !== undefined && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Total Budget</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
          </View>
        )}

        {snap.totalSpent !== undefined && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Total Spent</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmt(snap.totalSpent)}</Text>
          </View>
        )}

        {snap.lineCount !== undefined && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Budget Lines</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{snap.lineCount}</Text>
          </View>
        )}

        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>ID</Text>
          <Text style={[styles.detailId, { color: colors.mutedForeground }]} numberOfLines={1}>{snap.id}</Text>
        </View>

        <View style={styles.detailActions}>
          <TouchableOpacity
            style={[styles.detailBtn, { backgroundColor: snap.pinned ? colors.muted : colors.primary + "20" }]}
            onPress={() => onPin(snap.id, !snap.pinned)}
            disabled={pinning}
          >
            {pinning ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="bookmark" size={14} color={snap.pinned ? colors.foreground : colors.primary} />
                <Text style={[styles.detailBtnText, { color: snap.pinned ? colors.foreground : colors.primary }]}>
                  {snap.pinned ? "Unpin" : "Pin"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.detailBtn, { backgroundColor: colors.muted }]}
            onPress={() => onDownload(snap.id)}
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <Feather name="download" size={14} color={colors.foreground} />
                <Text style={[styles.detailBtnText, { color: colors.foreground }]}>Download</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.detailBtn, { backgroundColor: "#f59e0b" }]}
            onPress={onRestore}
            disabled={restoring}
          >
            {restoring ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="rotate-ccw" size={14} color="#fff" />
                <Text style={styles.detailBtnText}>Restore</Text>
              </>
            )}
          </TouchableOpacity>

          {!isProtected && (
            <TouchableOpacity
              style={[styles.detailBtn, { backgroundColor: "#ef444420" }]}
              onPress={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <>
                  <Feather name="trash-2" size={14} color="#ef4444" />
                  <Text style={[styles.detailBtnText, { color: "#ef4444" }]}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <Text style={[styles.detailWarning, { color: colors.mutedForeground }]}>
            Restoring will overwrite all current budget data.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function ComparePanel({
  aId,
  bId,
  snapshots,
  onClose,
}: {
  aId: string;
  bId: string;
  snapshots: SnapshotMeta[];
  onClose: () => void;
}) {
  const colors = useColors();
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { data: diff, isLoading, error } = useCompareSnapshots(
    aId && bId ? { a: aId, b: bId } : null
  );

  const fmt = (v: number | null) =>
    v == null ? "—" : "£" + Math.round(v).toLocaleString("en-GB");

  const snapA = snapshots.find((s) => s.id === aId);
  const snapB = snapshots.find((s) => s.id === bId);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const displayLines: SnapshotDiffLine[] = diff
    ? showUnchanged
      ? diff.lines
      : diff.lines.filter((l) => l.status !== "unchanged")
    : [];

  const statusColor: Record<string, string> = {
    added: "#10b981",
    removed: "#ef4444",
    changed: "#f59e0b",
    unchanged: colors.mutedForeground,
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.comparePanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>Snapshot Comparison</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.compareAB, { borderBottomColor: colors.border }]}>
          <View style={styles.compareSlot}>
            <View style={[styles.slotBadge, { backgroundColor: "#3b82f6" }]}>
              <Text style={styles.slotBadgeText}>A</Text>
            </View>
            <View>
              <LabelBadge label={snapA?.label ?? aId} />
              <Text style={[styles.rowDate, { color: colors.mutedForeground, marginTop: 2 }]}>
                {snapA ? formatDate(snapA.createdAt) : ""}
              </Text>
            </View>
          </View>
          <View style={styles.compareSlot}>
            <View style={[styles.slotBadge, { backgroundColor: "#10b981" }]}>
              <Text style={styles.slotBadgeText}>B</Text>
            </View>
            <View>
              <LabelBadge label={snapB?.label ?? bId} />
              <Text style={[styles.rowDate, { color: colors.mutedForeground, marginTop: 2 }]}>
                {snapB ? formatDate(snapB.createdAt) : ""}
              </Text>
            </View>
          </View>
        </View>

        {isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}

        {error && (
          <View style={[styles.compareError, { borderColor: "#ef444440" }]}>
            <Feather name="alert-circle" size={16} color="#ef4444" />
            <Text style={[styles.compareErrorText, { color: "#ef4444" }]}>Failed to load comparison</Text>
          </View>
        )}

        {diff && (
          <>
            <View style={styles.summaryRow}>
              {(["added", "removed", "changed", "unchanged"] as const).map((s) => (
                <View key={s} style={[styles.summaryChip, { backgroundColor: statusColor[s] + "20" }]}>
                  <Text style={[styles.summaryCount, { color: statusColor[s] }]}>{diff.summary[s]}</Text>
                  <Text style={[styles.summaryLabel, { color: statusColor[s] }]}>{s}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.toggleUnchanged}
              onPress={() => setShowUnchanged((v) => !v)}
            >
              <Feather
                name={showUnchanged ? "eye-off" : "eye"}
                size={13}
                color={colors.mutedForeground}
              />
              <Text style={[styles.toggleUnchangedText, { color: colors.mutedForeground }]}>
                {showUnchanged ? "Hide unchanged" : "Show unchanged"}
              </Text>
            </TouchableOpacity>

            <View style={styles.diffList}>
              {displayLines.map((line, idx) => {
                const key = `${line.category}|${line.lineItem}|${idx}`;
                const isExpanded = expandedKey === key;
                const delta =
                  line.totalBudgetA != null && line.totalBudgetB != null
                    ? line.totalBudgetB - line.totalBudgetA
                    : null;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.diffRow, { borderColor: statusColor[line.status] + "40" }]}
                    onPress={() => setExpandedKey(isExpanded ? null : key)}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.diffRowHeader,
                        { backgroundColor: statusColor[line.status] + "10" },
                      ]}
                    >
                      <View style={styles.diffRowLeft}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: statusColor[line.status],
                          }}
                        />
                        <View>
                          <Text style={[styles.diffLineItem, { color: colors.foreground }]}>
                            {line.lineItem}
                          </Text>
                          <Text style={[styles.diffCategory, { color: colors.mutedForeground }]}>
                            {line.category}
                            {line.subcategory ? ` › ${line.subcategory}` : ""}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.diffRowRight}>
                        <Text style={[styles.diffBudget, { color: colors.mutedForeground }]}>
                          {fmt(line.totalBudgetA)} → {fmt(line.totalBudgetB)}
                        </Text>
                        {delta != null && delta !== 0 && (
                          <Text
                            style={[
                              styles.diffDelta,
                              { color: delta > 0 ? "#ef4444" : "#10b981" },
                            ]}
                          >
                            {delta > 0 ? "+" : ""}
                            {fmt(delta)}
                          </Text>
                        )}
                        <Feather
                          name={isExpanded ? "chevron-up" : "chevron-down"}
                          size={13}
                          color={colors.mutedForeground}
                        />
                      </View>
                    </View>

                    {isExpanded && line.changes.length > 0 && (
                      <View style={[styles.diffDetail, { borderTopColor: colors.border }]}>
                        <View style={styles.diffSection}>
                          <Text style={[styles.diffSectionTitle, { color: colors.mutedForeground }]}>
                            Changes
                          </Text>
                          {line.changes.map((ch, ci) => (
                            <View key={ci} style={styles.diffChangeRow}>
                              <Text style={[styles.diffChangeField, { color: colors.mutedForeground }]}>
                                {ch.field}
                              </Text>
                              <Text style={[styles.diffChangeVal, { color: "#ef4444" }]}>
                                {ch.from ?? "—"}
                              </Text>
                              <Feather name="arrow-right" size={11} color={colors.mutedForeground} />
                              <Text style={[styles.diffChangeVal, { color: "#10b981" }]}>
                                {ch.to ?? "—"}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: Platform.OS === "web" ? "row" : "column",
  },
  scroll: {
    flex: 1,
  },
  desktopContent: {
    flex: 1,
    height: "100%",
  },
  desktopMain: {
    flex: 1,
  },
  splitView: {
    flex: 1,
    flexDirection: "row",
  },
  listPane: {
    flex: 1.2,
    padding: 24,
  },
  detailPane: {
    flex: 1,
    borderLeftWidth: 1,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  topBarActions: {
    flexDirection: "row",
    gap: 8,
  },
  compareBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  compareBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  savePanel: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  savePanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  savePanelTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  savePanelSubtext: {
    fontSize: 13,
    marginBottom: 12,
  },
  saveRow: {
    flexDirection: "row",
    gap: 8,
  },
  labelInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 8,
    gap: 8,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  explainer: {
    fontSize: 13,
    marginBottom: 16,
  },
  compareHint: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  compareHintText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  rowList: {
    gap: 1,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  groupHeaderText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  noSelection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  noSelectionText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: "center",
  },
  empty: {
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    marginTop: 20,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
  mobileModal: {
    flex: 1,
  },
  mobileModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
  },
  mobileModalTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalBox: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 2,
    overflow: "hidden",
    padding: 20,
  },
  modalWarningStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f59e0b15",
    padding: 10,
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: 20,
  },
  modalWarningText: {
    color: "#f59e0b",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  snapPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginBottom: 20,
  },
  snapPreviewDate: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  confirmInstruction: {
    fontSize: 13,
    marginBottom: 8,
  },
  confirmInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 20,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  rowLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  rowDownloadBtn: { padding: 2 },
  rowMeta: { gap: 4 },
  rowDate: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rowRight: { alignItems: "flex-end", gap: 2, marginRight: 4 },
  rowBudget: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowLines: { fontSize: 11 },
  rowBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  pinBtn: { padding: 2, marginRight: 2 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  slotBadge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  slotBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
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
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalSubtitle: { fontSize: 13, lineHeight: 18 },
  modalInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: "center" },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  comparePanel: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  compareAB: { flexDirection: "row", gap: 8, alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1 },
  compareSlot: { flex: 1, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  compareError: { borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: "row", gap: 8, alignItems: "center" },
  compareErrorText: { fontSize: 13 },
  summaryRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  summaryChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: "center", gap: 2 },
  summaryCount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  toggleUnchanged: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  toggleUnchangedText: { fontSize: 12 },
  diffList: { gap: 6 },
  diffRow: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  diffRowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, gap: 8 },
  diffRowLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  diffLineItem: { fontSize: 13, fontFamily: "Inter_500Medium" },
  diffCategory: { fontSize: 11 },
  diffRowRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  diffBudget: { fontSize: 12, fontFamily: "Inter_500Medium" },
  diffDelta: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  diffDetail: { borderTopWidth: 1, padding: 10, gap: 10 },
  diffSection: { gap: 4 },
  diffSectionTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  diffChangeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  diffChangeField: { fontSize: 11, fontFamily: "Inter_500Medium", minWidth: 80 },
  diffChangeVal: { fontSize: 11, fontFamily: "Inter_500Medium" },
  pinToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  pinToggleText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
