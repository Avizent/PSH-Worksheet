import React, { useState, useCallback, useRef } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import {
  useListImports,
  useGetImport,
  useAssignImportRow,
  useConfirmImport,
  useListAlerts,
  useListBudgetLines,
  getListImportsQueryKey,
  getGetImportQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDashboardChartsQueryKey,
  getListBudgetLinesWithMonthlyQueryKey,
} from "@workspace/api-client-react";
import { getApiUrl } from "@/utils/getApiUrl";

type ImportRow = {
  id: number;
  importId: number;
  rowIndex: number;
  rawCategory?: string | null;
  rawLineItem?: string | null;
  rawMonth?: number | null;
  rawYear?: number | null;
  rawAmount?: number | null;
  rawInvoiceRef?: string | null;
  status: string;
  budgetLineId?: number | null;
  errorMessage?: string | null;
  rowHash?: string | null;
  createdAt: string;
};

type CsvImportType = {
  id: number;
  filename: string;
  status: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  errorRows: number;
  createdAt: string;
  updatedAt: string;
  rows: ImportRow[];
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatAmount(val: number | null | undefined): string {
  if (val == null) return "-";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

const MONTH_LABELS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ImportContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const queryClient = useQueryClient();

  const { data: imports, isLoading: importsLoading, refetch: refetchImports } = useListImports();
  const { data: alerts } = useListAlerts({ resolved: false });
  const { data: budgetLines } = useListBudgetLines();

  const [activeImportId, setActiveImportId] = useState<number | null>(null);
  const { data: activeImport, refetch: refetchActiveImport } = useGetImport(activeImportId ?? 0, {
    query: { enabled: !!activeImportId, queryKey: getGetImportQueryKey(activeImportId ?? 0) },
  });

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [assignModalRow, setAssignModalRow] = useState<ImportRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const assignMutation = useAssignImportRow();
  const confirmMutation = useConfirmImport();

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetchImports();
    if (activeImportId) await refetchActiveImport();
    setRefreshing(false);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/imports/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert("Upload failed: " + (err.error || response.statusText));
        return;
      }

      const result: CsvImportType = await response.json();
      setActiveImportId(result.id);
      queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() });
    } catch (e: unknown) {
      alert("Upload error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUploading(false);
    }
  };

  const handleFilePick = async () => {
    if (Platform.OS === "web") {
      if (fileInputRef.current) fileInputRef.current.click();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "text/csv",
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const file = new File([blob], asset.name || "import.csv", { type: "text/csv" });
        uploadFile(file);
      }
    } catch (e: unknown) {
      alert("Error picking file: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleAssign = (row: ImportRow) => {
    setAssignModalRow(row);
    setSearchQuery("");
  };

  const doAssign = (rowId: number, budgetLineId: number) => {
    assignMutation.mutate(
      { id: rowId, data: { budgetLineId } },
      {
        onSuccess: () => {
          setAssignModalRow(null);
          if (activeImportId) {
            queryClient.invalidateQueries({ queryKey: getGetImportQueryKey(activeImportId) });
            queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() });
          }
        },
      }
    );
  };

  const handleConfirm = () => {
    if (!activeImportId) return;
    confirmMutation.mutate(
      { id: activeImportId },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetImportQueryKey(activeImportId) });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardChartsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey() });
          alert(`Import confirmed: ${result.created} records created, ${result.skippedDuplicate} duplicates skipped`);
        },
      }
    );
  };

  const handleDelete = async (importId: number) => {
    setDeleting(true);
    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/imports/${importId}`, { method: "DELETE" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert("Delete failed: " + (err.error || response.statusText));
        return;
      }
      if (activeImportId === importId) setActiveImportId(null);
      queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardChartsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey() });
    } catch (e: unknown) {
      alert("Delete error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const filteredBudgetLines = budgetLines?.filter((bl) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return bl.lineItem.toLowerCase().includes(q) || bl.category.toLowerCase().includes(q);
  });

  const statusColor = (status: string) => {
    if (status === "matched") return "#16a34a";
    if (status === "unmatched") return "#d97706";
    if (status === "error") return "#dc2626";
    return colors.mutedForeground;
  };

  const importStatusBadge = (status: string) => {
    if (status === "confirmed") return { bg: "#dcfce7", text: "#16a34a", label: "Confirmed" };
    if (status === "ready") return { bg: "#dbeafe", text: "#2563eb", label: "Ready" };
    if (status === "needs_review") return { bg: "#fef3c7", text: "#d97706", label: "Needs Review" };
    if (status === "deleted") return { bg: "#fef2f2", text: "#dc2626", label: "Deleted" };
    return { bg: colors.muted, text: colors.mutedForeground, label: status };
  };

  const renderUploadArea = () => (
    <View style={{ marginBottom: 24 }}>
      {Platform.OS === "web" && (
        <input
          ref={fileInputRef as React.RefObject<HTMLInputElement>}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      )}
      <TouchableOpacity
        onPress={handleFilePick}
        activeOpacity={0.7}
        style={[
          styles.uploadArea,
          {
            borderColor: dragOver ? colors.primary : colors.border,
            backgroundColor: dragOver ? colors.primary + "08" : colors.card,
          },
        ]}
        {...(Platform.OS === "web"
          ? ({
              onDrop: handleDrop,
              onDragOver: handleDragOver,
              onDragLeave: handleDragLeave,
            } as Record<string, unknown>)
          : {})}
      >
        {uploading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <View style={[styles.uploadIcon, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="upload-cloud" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.uploadTitle, { color: colors.foreground }]}>
              {isDesktop ? "Drag & drop CSV file here" : "Tap to upload CSV"}
            </Text>
            <Text style={[styles.uploadSubtitle, { color: colors.mutedForeground }]}>
              {isDesktop ? "or click to browse" : "CSV with Category, Line Item, Month, Year, Amount columns"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderResultsTable = () => {
    if (!activeImport) return null;
    const imp = activeImport as CsvImportType;
    const badge = importStatusBadge(imp.status);

    return (
      <View style={[styles.resultsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.resultsHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.resultsTitle, { color: colors.foreground }]}>{imp.filename}</Text>
            <Text style={[styles.resultsSubtitle, { color: colors.mutedForeground }]}>
              {imp.totalRows} rows · {imp.matchedRows} matched · {imp.unmatchedRows} unmatched · {imp.errorRows} errors
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.statusBadgeText, { color: badge.text }]}>{badge.label}</Text>
          </View>
        </View>

        {imp.rows.map((row) => (
          <View
            key={row.id}
            style={[
              styles.resultRow,
              {
                borderTopColor: colors.border,
                backgroundColor: row.status === "error" ? "#fef2f2" : row.status === "unmatched" ? "#fffbeb" : "transparent",
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusColor(row.status) }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowText, { color: colors.foreground }]} numberOfLines={1}>
                {row.rawCategory ? `${row.rawCategory} / ` : ""}{row.rawLineItem || "Unknown"}
              </Text>
              <Text style={[styles.rowSubtext, { color: colors.mutedForeground }]}>
                {row.rawMonth ? MONTH_LABELS[row.rawMonth] : "?"} {row.rawYear || ""} · {formatAmount(row.rawAmount)}
                {row.rawInvoiceRef ? ` · ${row.rawInvoiceRef}` : ""}
              </Text>
              {row.errorMessage && (
                <Text style={[styles.errorText, { color: "#dc2626" }]}>{row.errorMessage}</Text>
              )}
            </View>
            {row.status === "unmatched" && (
              <TouchableOpacity
                onPress={() => handleAssign(row)}
                style={[styles.assignBtn, { backgroundColor: colors.primary + "15" }]}
              >
                <Feather name="link" size={14} color={colors.primary} />
                <Text style={[styles.assignBtnText, { color: colors.primary }]}>Assign</Text>
              </TouchableOpacity>
            )}
            {row.status === "matched" && (
              <Feather name="check-circle" size={16} color="#16a34a" />
            )}
          </View>
        ))}

        {imp.status !== "confirmed" && imp.matchedRows > 0 && (
          <View style={styles.confirmBar}>
            <TouchableOpacity
              onPress={handleConfirm}
              disabled={confirmMutation.isPending}
              style={[styles.confirmBtn, { backgroundColor: colors.primary, opacity: confirmMutation.isPending ? 0.6 : 1 }]}
            >
              {confirmMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.confirmBtnText}>
                    Confirm Import ({imp.matchedRows} rows)
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderDeleteConfirmModal = () => {
    if (!deleteConfirmId) return null;
    const imp = imports?.find((i) => i.id === deleteConfirmId);
    if (!imp) return null;
    const isConfirmed = imp.status === "confirmed";

    return (
      <Modal visible transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDeleteConfirmId(null)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card, maxWidth: 400 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete Import</Text>
              <TouchableOpacity onPress={() => setDeleteConfirmId(null)}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalRowInfo, { backgroundColor: "#fef2f2" }]}>
              <Feather name="alert-triangle" size={20} color="#dc2626" style={{ marginBottom: 8 }} />
              <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: "#991b1b", marginBottom: 4 }}>
                {isConfirmed
                  ? "This import has been confirmed. Deleting it will also remove all actual spend records created from it."
                  : "This will permanently mark this import as deleted."}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#991b1b" }}>
                {imp.filename} ({imp.totalRows} rows)
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => setDeleteConfirmId(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDelete(deleteConfirmId)}
                disabled={deleting}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: "#dc2626", alignItems: "center", opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  const renderImportHistory = () => {
    if (!imports || imports.length === 0) return null;
    const activeImports = imports.filter((i) => i.status !== "deleted");
    const deletedImports = imports.filter((i) => i.status === "deleted");

    return (
      <View style={{ marginTop: 24 }}>
        <SectionHeader title="Import History" subtitle={`${activeImports.length} active · ${deletedImports.length} deleted`} />
        {imports.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((imp) => {
          const badge = importStatusBadge(imp.status);
          const isActive = imp.id === activeImportId;
          const isDeleted = imp.status === "deleted";
          return (
            <TouchableOpacity
              key={imp.id}
              onPress={() => !isDeleted && setActiveImportId(imp.id)}
              activeOpacity={isDeleted ? 1 : 0.7}
              style={[
                styles.historyRow,
                {
                  backgroundColor: isDeleted ? colors.muted : isActive ? colors.primary + "08" : colors.card,
                  borderColor: isActive ? colors.primary : colors.border,
                  opacity: isDeleted ? 0.7 : 1,
                },
              ]}
            >
              <Feather name={isDeleted ? "trash-2" : "file-text"} size={18} color={isDeleted ? "#dc2626" : isActive ? colors.primary : colors.mutedForeground} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.historyFilename, { color: isDeleted ? colors.mutedForeground : colors.foreground, textDecorationLine: isDeleted ? "line-through" : "none" }]}>{imp.filename}</Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {formatDate(imp.createdAt)} · {imp.totalRows} rows · {imp.matchedRows} matched
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: badge.text }]}>{badge.label}</Text>
                </View>
                {!isDeleted && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation?.(); setDeleteConfirmId(imp.id); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderAssignModal = () => {
    if (!assignModalRow) return null;

    return (
      <Modal visible transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setAssignModalRow(null)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Assign to Budget Line</Text>
              <TouchableOpacity onPress={() => setAssignModalRow(null)}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalRowInfo, { backgroundColor: colors.muted }]}>
              <Text style={[styles.modalRowLabel, { color: colors.mutedForeground }]}>Unmatched Row</Text>
              <Text style={[styles.modalRowValue, { color: colors.foreground }]}>
                {assignModalRow.rawCategory ? `${assignModalRow.rawCategory} / ` : ""}
                {assignModalRow.rawLineItem || "Unknown"}
              </Text>
              <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]}>
                {assignModalRow.rawMonth ? MONTH_LABELS[assignModalRow.rawMonth] : "?"} {assignModalRow.rawYear || ""} · {formatAmount(assignModalRow.rawAmount)}
              </Text>
            </View>

            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Search budget lines..."
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            <FlatList
              data={filteredBudgetLines}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => doAssign(assignModalRow.id, item.id)}
                  style={[styles.budgetLineOption, { borderBottomColor: colors.border }]}
                  disabled={assignMutation.isPending}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.blOptionName, { color: colors.foreground }]}>{item.lineItem}</Text>
                    <Text style={[styles.blOptionCategory, { color: colors.mutedForeground }]}>{item.category}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  if (importsLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const content = (
    <ScrollView
      style={[styles.content, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentInner}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
      }
    >
      <SectionHeader title="Import Actuals" subtitle="Upload CSV files with monthly actual spend data" />

      {renderUploadArea()}

      {activeImport && renderResultsTable()}

      {renderImportHistory()}

      {(!imports || imports.length === 0) && !activeImport && (
        <EmptyState
          icon="upload"
          title="No imports yet"
          message="Upload a CSV file to import monthly actual spend data"
        />
      )}

      {renderAssignModal()}
      {renderDeleteConfirmModal()}
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={alerts?.length} />
        {content}
      </View>
    );
  }

  return content;
}

export default function ImportScreen() {
  return <ImportContent />;
}

const styles = StyleSheet.create({
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 24,
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  uploadArea: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  uploadTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  uploadSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  resultsCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  resultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  resultsTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  resultsSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  rowSubtext: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  errorText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  assignBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  assignBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  confirmBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  confirmBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
  },
  historyFilename: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  historyMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxWidth: 480,
    borderRadius: 16,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  modalRowInfo: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  modalRowLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalRowValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  modalRowMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  budgetLineOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  blOptionName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  blOptionCategory: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
});
