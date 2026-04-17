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
  useCompareSnapshots,
  getListSnapshotsQueryKey,
  type SnapshotMeta,
  type SnapshotDiff,
  type SnapshotDiffLine,
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
  compareSlot?: "A" | "B" | null;
  compareMode?: boolean;
}

function SnapshotRow({ snap, isSelected, onSelect, compareSlot, compareMode }: SnapshotRowProps) {
  const colors = useColors();

  let borderColor = isSelected ? colors.primary : colors.border;
  let bg = isSelected ? colors.primary + "10" : colors.card;
  if (compareSlot === "A") { borderColor = "#2563eb"; bg = "#2563eb10"; }
  if (compareSlot === "B") { borderColor = "#16a34a"; bg = "#16a34a10"; }

  return (
    <TouchableOpacity
      onPress={() => onSelect(snap.id)}
      activeOpacity={0.7}
      style={[styles.row, { backgroundColor: bg, borderColor }]}
    >
      <View style={styles.rowLeft}>
        {compareSlot ? (
          <View style={[
            styles.slotBadge,
            { backgroundColor: compareSlot === "A" ? "#2563eb" : "#16a34a" },
          ]}>
            <Text style={styles.slotBadgeText}>{compareSlot}</Text>
          </View>
        ) : (
          <Feather
            name={compareMode ? "circle" : "camera"}
            size={14}
            color={isSelected ? colors.primary : colors.mutedForeground}
          />
        )}
        <View style={styles.rowMeta}>
          <Text style={[styles.rowDate, { color: colors.foreground }]}>{fmtDate(snap.timestamp)}</Text>
          <LabelBadge label={snap.label} />
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowBudget, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
        <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>spent {fmt(snap.totalSpent)}</Text>
        <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>{snap.lineCount} lines</Text>
      </View>
      <Feather name="chevron-right" size={14} color={compareSlot ? borderColor : (isSelected ? colors.primary : colors.mutedForeground)} />
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

// ─── Diff status badge ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  added:     { bg: "#16a34a20", fg: "#16a34a", label: "Added" },
  removed:   { bg: "#dc262620", fg: "#dc2626", label: "Removed" },
  changed:   { bg: "#d9770620", fg: "#d97706", label: "Changed" },
  unchanged: { bg: "#6b728020", fg: "#6b7280", label: "Unchanged" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.unchanged;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

// ─── Diff line row ────────────────────────────────────────────────────────────

function DiffLineRow({ line }: { line: SnapshotDiffLine }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

  const budgetDelta =
    line.totalBudgetA != null && line.totalBudgetB != null
      ? line.totalBudgetB - line.totalBudgetA
      : null;

  const planChanges = line.changes.filter((c) => c.field.startsWith("plan:"));
  const actualChanges = line.changes.filter((c) => c.field.startsWith("actual:"));
  const fieldChanges = line.changes.filter((c) => !c.field.startsWith("plan:") && !c.field.startsWith("actual:"));

  return (
    <View style={[styles.diffRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => line.changes.length > 0 && setExpanded((e) => !e)}
        activeOpacity={line.changes.length > 0 ? 0.7 : 1}
        style={styles.diffRowHeader}
      >
        <View style={styles.diffRowLeft}>
          <StatusBadge status={line.status} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.diffLineItem, { color: colors.foreground }]} numberOfLines={1}>
              {line.lineItem}
            </Text>
            <Text style={[styles.diffCategory, { color: colors.mutedForeground }]}>
              {line.category}{line.subcategory ? ` · ${line.subcategory}` : ""}
            </Text>
          </View>
        </View>
        <View style={styles.diffRowRight}>
          {line.totalBudgetA != null && (
            <Text style={[styles.diffBudget, { color: colors.mutedForeground }]}>{fmt(line.totalBudgetA)}</Text>
          )}
          {line.totalBudgetA != null && line.totalBudgetB != null && (
            <Feather name="arrow-right" size={11} color={colors.mutedForeground} />
          )}
          {line.totalBudgetB != null && (
            <Text style={[styles.diffBudget, { color: colors.foreground }]}>{fmt(line.totalBudgetB)}</Text>
          )}
          {budgetDelta != null && budgetDelta !== 0 && (
            <Text style={[styles.diffDelta, { color: budgetDelta > 0 ? "#16a34a" : "#dc2626" }]}>
              {budgetDelta > 0 ? "+" : ""}{fmt(budgetDelta)}
            </Text>
          )}
          {line.changes.length > 0 && (
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={13} color={colors.mutedForeground} />
          )}
        </View>
      </TouchableOpacity>

      {expanded && line.changes.length > 0 && (
        <View style={[styles.diffDetail, { borderColor: colors.border }]}>
          {fieldChanges.length > 0 && (
            <View style={styles.diffSection}>
              <Text style={[styles.diffSectionTitle, { color: colors.mutedForeground }]}>Field changes</Text>
              {fieldChanges.map((c) => (
                <View key={c.field} style={styles.diffChangeRow}>
                  <Text style={[styles.diffChangeField, { color: colors.mutedForeground }]}>{c.field}</Text>
                  <Text style={[styles.diffChangeVal, { color: "#dc2626" }]}>{c.from ?? "—"}</Text>
                  <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.diffChangeVal, { color: "#16a34a" }]}>{c.to ?? "—"}</Text>
                </View>
              ))}
            </View>
          )}
          {planChanges.length > 0 && (
            <View style={styles.diffSection}>
              <Text style={[styles.diffSectionTitle, { color: colors.mutedForeground }]}>Monthly plan changes</Text>
              {planChanges.map((c) => (
                <View key={c.field} style={styles.diffChangeRow}>
                  <Text style={[styles.diffChangeField, { color: colors.mutedForeground }]}>{c.field.replace("plan:", "")}</Text>
                  <Text style={[styles.diffChangeVal, { color: "#dc2626" }]}>{"£" + Number(c.from ?? 0).toLocaleString("en-GB")}</Text>
                  <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.diffChangeVal, { color: "#16a34a" }]}>{"£" + Number(c.to ?? 0).toLocaleString("en-GB")}</Text>
                </View>
              ))}
            </View>
          )}
          {actualChanges.length > 0 && (
            <View style={styles.diffSection}>
              <Text style={[styles.diffSectionTitle, { color: colors.mutedForeground }]}>Monthly actual changes</Text>
              {actualChanges.map((c) => (
                <View key={c.field} style={styles.diffChangeRow}>
                  <Text style={[styles.diffChangeField, { color: colors.mutedForeground }]}>{c.field.replace("actual:", "")}</Text>
                  <Text style={[styles.diffChangeVal, { color: "#dc2626" }]}>{"£" + Number(c.from ?? 0).toLocaleString("en-GB")}</Text>
                  <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.diffChangeVal, { color: "#16a34a" }]}>{"£" + Number(c.to ?? 0).toLocaleString("en-GB")}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Compare panel ────────────────────────────────────────────────────────────

interface ComparePanelProps {
  aId: string;
  bId: string;
  snapshots: SnapshotMeta[];
  onClose: () => void;
}

function ComparePanel({ aId, bId, snapshots, onClose }: ComparePanelProps) {
  const colors = useColors();
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { data: diff, isLoading, error } = useCompareSnapshots({ a: aId, b: bId });

  const snapA = snapshots.find((s) => s.id === aId);
  const snapB = snapshots.find((s) => s.id === bId);

  const visibleLines = diff?.lines.filter((l) =>
    showUnchanged ? true : l.status !== "unchanged"
  ) ?? [];

  return (
    <View style={[styles.comparePanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.detailHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Feather name="git-merge" size={16} color={colors.primary} />
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>Snapshot Comparison</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.compareAB, { borderColor: colors.border }]}>
        <View style={styles.compareSlot}>
          <View style={[styles.slotBadge, { backgroundColor: "#2563eb" }]}>
            <Text style={styles.slotBadgeText}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowDate, { color: colors.foreground }]} numberOfLines={1}>
              {snapA ? fmtDate(snapA.timestamp) : aId}
            </Text>
            {snapA && <LabelBadge label={snapA.label} />}
          </View>
        </View>
        <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ alignSelf: "center" }} />
        <View style={styles.compareSlot}>
          <View style={[styles.slotBadge, { backgroundColor: "#16a34a" }]}>
            <Text style={styles.slotBadgeText}>B</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowDate, { color: colors.foreground }]} numberOfLines={1}>
              {snapB ? fmtDate(snapB.timestamp) : bId}
            </Text>
            {snapB && <LabelBadge label={snapB.label} />}
          </View>
        </View>
      </View>

      {isLoading && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
      )}

      {error && (
        <View style={[styles.compareError, { borderColor: "#dc2626", backgroundColor: "#dc262610" }]}>
          <Feather name="alert-circle" size={16} color="#dc2626" />
          <Text style={[styles.compareErrorText, { color: "#dc2626" }]}>Failed to load comparison</Text>
        </View>
      )}

      {diff && (
        <>
          <View style={styles.summaryRow}>
            {([
              { label: "Added", count: diff.summary.added, color: "#16a34a" },
              { label: "Removed", count: diff.summary.removed, color: "#dc2626" },
              { label: "Changed", count: diff.summary.changed, color: "#d97706" },
              { label: "Unchanged", count: diff.summary.unchanged, color: "#6b7280" },
            ] as const).map((s) => (
              <View key={s.label} style={[styles.summaryChip, { backgroundColor: s.color + "20" }]}>
                <Text style={[styles.summaryCount, { color: s.color }]}>{s.count}</Text>
                <Text style={[styles.summaryLabel, { color: s.color }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {diff.summary.unchanged > 0 && (
            <TouchableOpacity
              onPress={() => setShowUnchanged((v) => !v)}
              style={styles.toggleUnchanged}
            >
              <Feather
                name={showUnchanged ? "eye-off" : "eye"}
                size={13}
                color={colors.mutedForeground}
              />
              <Text style={[styles.toggleUnchangedText, { color: colors.mutedForeground }]}>
                {showUnchanged ? "Hide unchanged lines" : `Show ${diff.summary.unchanged} unchanged line${diff.summary.unchanged !== 1 ? "s" : ""}`}
              </Text>
            </TouchableOpacity>
          )}

          {visibleLines.length === 0 ? (
            <View style={[styles.empty, { borderColor: colors.border, marginTop: 8 }]}>
              <Feather name="check-circle" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No differences found between these snapshots.
              </Text>
            </View>
          ) : (
            <View style={styles.diffList}>
              {visibleLines.map((line, idx) => (
                <DiffLineRow key={`${line.category}|${line.lineItem}|${idx}`} line={line} />
              ))}
            </View>
          )}

          <Text style={[styles.detailWarning, { color: colors.mutedForeground, marginTop: 8 }]}>
            This view is read-only. Use the normal snapshot list to restore.
          </Text>
        </>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

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

  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

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
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={() => { setLabelInput(""); setShowSaveModal(true); }}
            activeOpacity={0.8}
          >
            <Feather name="camera" size={13} color="#fff" />
            <Text style={styles.saveBtnText}>Save Snapshot</Text>
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
      ) : (
        <View style={styles.rowList}>
          {(snapshots as SnapshotMeta[]).map((snap) => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              isSelected={!compareMode && selectedId === snap.id}
              onSelect={handleRowSelect}
              compareSlot={compareA === snap.id ? "A" : compareB === snap.id ? "B" : null}
              compareMode={compareMode}
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

  const compareContent =
    compareMode && showCompare && compareA && compareB ? (
      <ComparePanel
        aId={compareA}
        bId={compareB}
        snapshots={snapshots as SnapshotMeta[]}
        onClose={() => { setShowCompare(false); setCompareA(null); setCompareB(null); }}
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
            {!compareMode && detailContent && (
              <View style={styles.detailPaneDesktop}>
                {detailContent}
              </View>
            )}
          </View>
          {compareContent && (
            <View style={{ marginTop: 16 }}>
              {compareContent}
            </View>
          )}
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
        {!compareMode && selectedSnap && (
          <View style={styles.detailPaneMobile}>
            {detailContent}
          </View>
        )}
        {compareContent && (
          <View style={{ marginTop: 8 }}>
            {compareContent}
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
  topBarActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  compareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  compareBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  compareHint: { borderRadius: 8, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  compareHintText: { flex: 1, fontSize: 13, lineHeight: 18 },
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
});
