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
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { AdminSubnav } from "@/components/AdminSubnav";
import { SectionHeader } from "@/components/SectionHeader";
import { useTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/contexts/ToastContext";
import {
  useListSnapshots,
  useCreateSnapshot,
  useRestoreSnapshot,
  useDeleteSnapshot,
  useCompareSnapshots,
  usePinSnapshot,
  getListSnapshotsQueryKey,
} from "@workspace/api-client-react/snapshots";
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

  const fmt = (v: number) => "£" + Math.round(v).toLocaleString("en-GB");
  const fmtDate = (d: string) => formatDate(d);

  const { data: snapshots = [], isLoading, refetch, isFetching } = useListSnapshots();

  const createMutation = useCreateSnapshot();
  const restoreMutation = useRestoreSnapshot();
  const deleteMutation = useDeleteSnapshot();
  const pinSnap = usePinSnapshot();

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
    if (Platform.OS === "web") {
      if (window.confirm(`Delete snapshot "${snap.label}"? This cannot be undone.`)) doDelete();
    } else {
      doDelete();
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
      restoring={restoring && restoreTarget?.id === selectedSnap.id}
      deleting={deletingId === selectedSnap.id}
      downloading={downloadingId === selectedSnap.id}
      pinning={pinningId === selectedSnap.id}
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
