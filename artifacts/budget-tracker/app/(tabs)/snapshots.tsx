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
import * as FileSystem from "expo-file-system/legacy";
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
} from "@workspace/api-client-react/snapshots";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/utils/getApiUrl";
import { apiFetch } from "@/lib/apiFetch";
import { useCurrency } from "@/contexts/CurrencyContext";

const PROTECTED_LABELS = ["pre-import", "pre-restore"];


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

// ─── Label badge ──────────────────────────────────────────────────────────────

function LabelBadge({ label }: { label: string }) {
  const colors = useColors();
  const isAuto = label.startsWith("auto-");
  const isPreRestore = label === "pre-restore";
  const isPreImport = label === "pre-import";
  const isNightly = label === "nightly";

  let bg = colors.muted;
  let fg = colors.mutedForeground;
  if (isAuto) { bg = colors.primary + "20"; fg = colors.primary; }
  if (isPreRestore) { bg = "#7c3aed20"; fg = "#7c3aed"; }
  if (isPreImport) { bg = "#ea580c20"; fg = "#ea580c"; }
  if (isNightly) { bg = "#0d948820"; fg = "#0d9488"; }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

// ─── Snapshot row ─────────────────────────────────────────────────────────────

interface SnapshotRowProps {
  snap: SnapshotMeta;
  isSelected: boolean;
  isDownloading: boolean;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (snap: SnapshotMeta) => void;
  compareSlot?: "A" | "B" | null;
  compareMode?: boolean;
  onPin: (id: string, pinned: boolean) => void;
  pinning: boolean;
}

function SnapshotRow({ snap, isSelected, isDownloading, onSelect, onDownload, onDelete, compareSlot, compareMode, onPin, pinning }: SnapshotRowProps) {
  const { format: fmt } = useCurrency();
  const colors = useColors();
  const isProtected = PROTECTED_LABELS.includes(snap.label);

  let borderColor = isSelected ? colors.primary : colors.border;
  let bg = isSelected ? colors.primary + "10" : colors.card;
  if (!compareSlot && snap.pinned) { borderColor = "#f59e0b"; }
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
            name={compareMode ? "circle" : (snap.pinned ? "bookmark" : "camera")}
            size={14}
            color={snap.pinned ? "#f59e0b" : (isSelected ? colors.primary : colors.mutedForeground)}
          />
        )}
        <View style={styles.rowMeta}>
          <View style={styles.rowBadgeRow}>
            <LabelBadge label={snap.label} />
            {snap.pinned && (
              <View style={[styles.badge, { backgroundColor: "#f59e0b20" }]}>
                <Text style={[styles.badgeText, { color: "#f59e0b" }]}>pinned</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowDate, { color: colors.mutedForeground }]}>{fmtDate(snap.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowBudget, { color: colors.foreground }]}>{fmt(snap.totalBudget)}</Text>
        <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>spent {fmt(snap.totalSpent)}</Text>
        <Text style={[styles.rowLines, { color: colors.mutedForeground }]}>{snap.lineCount} lines</Text>
      </View>
      {!compareMode && (
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onPin(snap.id, !snap.pinned); }}
            style={styles.rowIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={pinning}
          >
            {pinning ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather
                name="bookmark"
                size={14}
                color={snap.pinned ? "#f59e0b" : colors.mutedForeground}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onDownload(snap.id); }}
            style={styles.rowIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather name="download" size={14} color={colors.mutedForeground} />
            )}
          </TouchableOpacity>
          {!isProtected && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onDelete(snap); }}
              style={styles.rowIconBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="trash-2" size={14} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>
      )}
      <Feather
        name="chevron-right"
        size={14}
        color={compareSlot ? borderColor : (isSelected ? colors.primary : colors.mutedForeground)}
      />
    </TouchableOpacity>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  snap: SnapshotMeta;
  onRestore: () => void;
  onDelete: (snap: SnapshotMeta) => void;
  onDownload: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onClose: () => void;
  onRename: (newLabel: string) => Promise<void>;
  restoring: boolean;
  deleting: boolean;
  downloading: boolean;
  pinning: boolean;
  renaming: boolean;
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
}: DetailPanelProps) {
  const { format: fmt } = useCurrency();
  const colors = useColors();
  const [editMode, setEditMode] = useState(false);
  const [editLabel, setEditLabel] = useState(snap.label);
  const spent = snap.totalBudget > 0 ? (snap.totalSpent / snap.totalBudget) * 100 : 0;
  const isProtected = PROTECTED_LABELS.includes(snap.label);

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
      // keep edit mode open so the user can retry or cancel
    }
  };

  return (
    <View style={[styles.detail, { backgroundColor: colors.card, borderColor: snap.pinned ? "#f59e0b" : colors.border }]}>
      <View style={styles.detailHeader}>
        <Text style={[styles.detailTitle, { color: colors.foreground }]}>Snapshot Detail</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Saved</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>{fmtDate(snap.createdAt)}</Text>
      </View>

      <View style={[styles.detailSection, { borderColor: colors.border }]}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Label</Text>
        {editMode ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.background, borderColor: colors.primary, color: colors.foreground, flex: 1, maxWidth: 160, paddingVertical: 4 }]}
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
          onPress={onRestore}
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
          style={[styles.detailBtn, { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => onPin(snap.id, !snap.pinned)}
          disabled={pinning}
          activeOpacity={0.8}
        >
          {pinning ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <>
              <Feather name="bookmark" size={13} color={snap.pinned ? "#f59e0b" : colors.foreground} />
              <Text style={[styles.detailBtnText, { color: snap.pinned ? "#f59e0b" : colors.foreground }]}>
                {snap.pinned ? "Unpin Snapshot" : "Pin Snapshot"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.detailBtn, { backgroundColor: "#059669" }]}
          onPress={() => onDownload(snap.id)}
          disabled={restoring || deleting || downloading}
          activeOpacity={0.8}
        >
          {downloading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="download" size={13} color="#fff" />
              <Text style={styles.detailBtnText}>Download JSON</Text>
            </>
          )}
        </TouchableOpacity>

        {!isProtected && (
          <TouchableOpacity
            style={[styles.detailBtn, { backgroundColor: "#ef444410", borderColor: "#ef4444", borderWidth: 1 }]}
            onPress={() => onDelete(snap)}
            disabled={restoring || deleting}
            activeOpacity={0.8}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <>
                <Feather name="trash-2" size={13} color="#ef4444" />
                <Text style={[styles.detailBtnText, { color: "#ef4444" }]}>Delete Snapshot</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.detailWarning, { color: colors.mutedForeground }]}>
        Restoring will overwrite all current data. A pre-restore backup will be saved automatically.
        {snap.pinned ? " This snapshot is pinned and will never be auto-deleted." : ""}
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
  const { format: fmt } = useCurrency();
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
                  <Text style={[styles.diffChangeVal, { color: "#dc2626" }]}>{fmt(Number(c.from ?? 0))}</Text>
                  <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.diffChangeVal, { color: "#16a34a" }]}>{fmt(Number(c.to ?? 0))}</Text>
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
                  <Text style={[styles.diffChangeVal, { color: "#dc2626" }]}>{fmt(Number(c.from ?? 0))}</Text>
                  <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.diffChangeVal, { color: "#16a34a" }]}>{fmt(Number(c.to ?? 0))}</Text>
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
  const { currency } = useCurrency();
  const colors = useColors();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfIncludeUnchanged, setPdfIncludeUnchanged] = useState(false);

  const { data: diff, isLoading, error } = useCompareSnapshots(aId, bId);

  const handleExportPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const { getVpSessionToken } = await import("@/utils/vpSession");
      const { getSessionToken } = await import("@/lib/authSession");
      const vpToken = getVpSessionToken();
      const userToken = await getSessionToken();
      const baseUrl = getApiUrl();
      const params = new URLSearchParams({ a: aId, b: bId, currency });
      if (pdfIncludeUnchanged) params.set("includeUnchanged", "true");
      const url = `${baseUrl}/api/snapshots/compare/pdf?${params.toString()}`;
      const headers: Record<string, string> = {};
      if (vpToken) headers["x-vp-session"] = vpToken;
      if (userToken) headers["x-user-session"] = userToken;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error("Export failed");
      if (Platform.OS === "web") {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "snapshot-comparison.pdf";
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunkSize = 8192;
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
          binary += String.fromCharCode(...Array.from(chunk));
        }
        const base64 = btoa(binary);
        const fileUri = `${FileSystem.cacheDirectory}snapshot-comparison.pdf`;
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/pdf",
            dialogTitle: "Save PDF comparison",
            UTI: "com.adobe.pdf",
          });
        } else {
          Alert.alert("Error", "Sharing is not available on this device.");
        }
      }
    } catch {
      Alert.alert("Export Failed", "Could not generate the PDF. Please try again.");
    } finally {
      setPdfLoading(false);
    }
  }, [aId, bId, pdfIncludeUnchanged]);

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
              {snapA ? fmtDate(snapA.createdAt) : aId}
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
              {snapB ? fmtDate(snapB.createdAt) : bId}
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

          <View style={styles.exportRow}>
            <TouchableOpacity
              onPress={() => setPdfIncludeUnchanged((v) => !v)}
              style={[styles.toggleUnchanged, { flex: 1 }]}
              activeOpacity={0.7}
            >
              <Feather
                name={pdfIncludeUnchanged ? "check-square" : "square"}
                size={13}
                color={colors.mutedForeground}
              />
              <Text style={[styles.toggleUnchangedText, { color: colors.mutedForeground }]}>
                Include unchanged lines in PDF
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleExportPdf}
              disabled={pdfLoading}
              activeOpacity={0.8}
              style={[styles.exportPdfBtn, { backgroundColor: colors.primary, opacity: pdfLoading ? 0.7 : 1 }]}
            >
              {pdfLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="download" size={13} color="#fff" />
                  <Text style={styles.exportPdfBtnText}>Export PDF</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

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
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SnapshotMeta | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const renameMutation = useRenameSnapshot();

  const { data: snapshots = [], isLoading, refetch, isFetching } = useListSnapshots();
  const createSnap = useCreateSnapshot();
  const restoreSnap = useRestoreSnapshot();
  const deleteSnap = useDeleteSnapshot();
  const pinSnap = usePinSnapshot();
  const importMutation = useImportSnapshot();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
  }, [queryClient]);

  const handleSave = useCallback(async () => {
    setSavingId("saving");
    try {
      const label = labelInput.trim() || "manual";
      await createSnap.mutateAsync({ label });
      showToast(`Snapshot "${label}" saved.`, "success");
      setShowSaveModal(false);
      setLabelInput("");
      invalidate();
    } catch {
      showToast("Failed to save snapshot.", "error");
    } finally {
      setSavingId(null);
    }
  }, [labelInput, createSnap, showToast, invalidate]);

  const openRestoreModal = useCallback((snap: SnapshotMeta) => {
    setRestoreTarget(snap);
    setConfirmText("");
  }, []);

  const handleRestore = useCallback(async () => {
    if (!restoreTarget || confirmText !== "CONFIRM") return;
    setRestoring(true);
    try {
      await restoreSnap.mutateAsync(restoreTarget.id);
      showToast(`Restored from "${restoreTarget.label}" snapshot.`, "success");
      invalidate();
      setRestoreTarget(null);
      setConfirmText("");
      setSelectedId(null);
    } catch {
      showToast("Restore failed. Check the server logs.", "error");
    } finally {
      setRestoring(false);
    }
  }, [restoreTarget, confirmText, restoreSnap, showToast, invalidate]);

  const openDeleteModal = useCallback((snap: SnapshotMeta) => {
    if (PROTECTED_LABELS.includes(snap.label)) {
      showToast("This snapshot is protected and cannot be deleted.", "error");
      return;
    }
    setDeleteTarget(snap);
  }, [showToast]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const snap = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(snap.id);
    deleteSnap.mutate(
      { id: snap.id },
      {
        onSuccess: () => {
          invalidate();
          showToast("Snapshot deleted.", "success");
          if (selectedId === snap.id) setSelectedId(null);
        },
        onError: () => showToast("Failed to delete snapshot.", "error"),
        onSettled: () => setDeletingId(null),
      }
    );
  }, [deleteTarget, deleteSnap, invalidate, showToast, selectedId]);

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
    if (!compareA) { setCompareA(id); return; }
    if (!compareB) { setCompareB(id); setShowCompare(true); return; }
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
        const res = await apiFetch(url);
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
        const res = await apiFetch(url);
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
        }
      }
    } catch {
      showToast("Failed to download snapshot.", "error");
    } finally {
      setDownloadingId(null);
    }
  }, [showToast]);

  const handlePin = useCallback((id: string, pinned: boolean) => {
    setPinningId(id);
    pinSnap.mutate(
      { id, data: { pinned } },
      {
        onSuccess: () => invalidate(),
        onError: () => showToast("Failed to update pin state.", "error"),
        onSettled: () => setPinningId(null),
      }
    );
  }, [pinSnap, invalidate, showToast]);

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
          const text = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
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
          title="Snapshots"
          subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} saved`}
        />
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={[styles.compareBtn, { backgroundColor: colors.muted, borderColor: colors.border, opacity: importMutation.isPending ? 0.6 : 1 }]}
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
            style={[styles.compareBtn, { backgroundColor: compareMode ? colors.primary : colors.muted, borderColor: compareMode ? colors.primary : colors.border }]}
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
            onDelete={openDeleteModal}
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
      onDelete={openDeleteModal}
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

  const restoreModal = (
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
                  {fmtDate(restoreTarget.createdAt)}
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
                  style={[styles.modalButton, { backgroundColor: "#f59e0b", opacity: confirmText !== "CONFIRM" || restoring ? 0.5 : 1 }]}
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
  );

  const deleteModal = (
    <Modal
      visible={!!deleteTarget}
      transparent
      animationType="fade"
      onRequestClose={() => setDeleteTarget(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: "#f59e0b" }]}>
          <View style={styles.modalWarningStrip}>
            <Feather name="alert-triangle" size={18} color="#f59e0b" />
            <Text style={styles.modalWarningText}>Warning — This cannot be undone</Text>
          </View>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete Snapshot</Text>
          {deleteTarget && (
            <>
              <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                Are you sure you want to permanently delete this snapshot?
              </Text>
              <View style={[styles.snapPreview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <LabelBadge label={deleteTarget.label} />
                <Text style={[styles.snapPreviewDate, { color: colors.foreground }]}>
                  {fmtDate(deleteTarget.createdAt)}
                </Text>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => setDeleteTarget(null)}
                  style={[styles.modalButton, { backgroundColor: colors.muted }]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.foreground }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmDelete}
                  style={[styles.modalButton, { backgroundColor: "#ef4444" }]}
                >
                  <Feather name="trash-2" size={14} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.modalButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
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
        {restoreModal}
        {deleteModal}
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
      {restoreModal}
      {deleteModal}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Sidebar sits beside the content, matching every other screen. Without
  // flexDirection: "row" they stack vertically and the sidebar (whose nav
  // scrolls with flex: 1) consumes the full height, hiding the content.
  desktopContainer: { flex: 1, flexDirection: "row" },
  desktopScroll: { padding: 24, paddingBottom: 80, minHeight: "100%" },
  mobileScroll: { padding: 16, paddingBottom: 80 },
  desktopSplit: { flexDirection: "row", gap: 24, alignItems: "flex-start", marginTop: 16 },
  listPane: { flex: 1, gap: 12 },
  detailPaneDesktop: { width: 340 },
  detailPaneMobile: { marginTop: 4 },
  topBar: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  topBarActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  compareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  rowLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowIconBtn: { padding: 4 },
  compareBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  savePanel: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  savePanelHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  savePanelTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  savePanelSubtext: { fontSize: 13, marginBottom: 12 },
  saveRow: { flexDirection: "row", gap: 8 },
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
  saveButtonText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  explainer: { fontSize: 13, marginBottom: 16 },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 4,
  },
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
  pinToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  pinToggleText: { fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { width: "100%", maxWidth: 440, borderRadius: 16, borderWidth: 2, overflow: "hidden", padding: 20, gap: 0 },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 8 },
  modalSubtitle: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  modalInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: "center" },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalWarningStrip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f59e0b15", padding: 10, marginHorizontal: -20, marginTop: -20, marginBottom: 20 },
  modalWarningText: { color: "#f59e0b", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modalButton: { flex: 1, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  modalButtonText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  snapPreview: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 8, borderWidth: 1, gap: 10, marginBottom: 20 },
  snapPreviewDate: { fontSize: 13, fontFamily: "Inter_500Medium" },
  confirmInstruction: { fontSize: 13, marginBottom: 8 },
  confirmInput: { height: 44, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 20, textAlign: "center" },
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
  exportRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  exportPdfBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  exportPdfBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
