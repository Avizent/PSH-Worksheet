import React, { useState, useRef, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { AdminSubnav } from "@/components/AdminSubnav";
import { SectionHeader } from "@/components/SectionHeader";
import { useToast } from "@/contexts/ToastContext";
import { getApiUrl } from "@/utils/getApiUrl";
import { useListAlerts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListBudgetLinesWithMonthlyQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";

interface ValidationError {
  column: string;
  row: number;
  message: string;
}

interface ImportResult {
  valid: boolean;
  message: string;
  snapshotSaved: boolean;
  counts: {
    upserted: number;
    inserted: number;
    deleted: number;
    plansWritten: number;
    actualsWritten: number;
  };
}

interface DiffLine {
  category: string;
  lineItem: string;
}

interface ImportDiff {
  toAdd: DiffLine[];
  toUpdate: DiffLine[];
  toDelete: DiffLine[];
}

type ImportState =
  | { phase: "idle" }
  | { phase: "validating" }
  | { phase: "errors"; errors: ValidationError[] }
  | { phase: "confirm"; file: File; rowCount: number; diff: ImportDiff }
  | { phase: "importing" }
  | { phase: "done"; result: ImportResult };

export default function ExcelScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: alertsData } = useListAlerts({ resolved: false });
  const activeAlerts = alertsData ?? [];

  const [exportLoading, setExportLoading] = useState(false);
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });
  const [confirmText, setConfirmText] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const baseUrl = getApiUrl();
      const url = `${baseUrl}/api/excel/export`;

      if (Platform.OS === "web") {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const today = new Date().toISOString().slice(0, 10);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `budget_export_${today}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast("Excel file downloaded.");
      } else {
        // Native: download to cache then share via system share sheet
        const { FileSystem, Sharing } = await loadNativeModules();
        if (!FileSystem || !Sharing) {
          showToast("Sharing not available on this device.", "error");
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const filename = `budget_export_${today}.xlsx`;
        const localUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.downloadAsync(url, localUri);
        await Sharing.shareAsync(localUri, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Save or share budget export",
          UTI: "org.openxmlformats.spreadsheetml.sheet",
        });
      }
    } catch (e: unknown) {
      showToast("Export failed: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setExportLoading(false);
    }
  };

  // ─── Import: Step 1 — pick and validate ────────────────────────────────────

  const pickAndValidate = async () => {
    if (Platform.OS === "web") {
      fileInputRef.current?.click();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const file = new File([blob], asset.name ?? "import.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await validateFile(file);
      }
    } catch (e: unknown) {
      showToast("Error picking file: " + (e instanceof Error ? e.message : String(e)), "error");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (file) await validateFile(file);
    if (e.target) e.target.value = "";
  };

  const validateFile = async (file: File) => {
    setImportState({ phase: "validating" });
    setConfirmText("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/excel/validate`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || json.valid === false) {
        setImportState({
          phase: "errors",
          errors: json.errors ?? [{ column: "file", row: 0, message: json.error ?? "Unknown error" }],
        });
        return;
      }

      // Validation passed — move to confirm stage (no DB writes yet)
      setImportState({
        phase: "confirm",
        file,
        rowCount: json.rowCount,
        diff: json.diff ?? { toAdd: [], toUpdate: [], toDelete: [] },
      });
    } catch (e: unknown) {
      showToast("Validation error: " + (e instanceof Error ? e.message : String(e)), "error");
      setImportState({ phase: "idle" });
    }
  };

  // ─── Import: Step 2 — confirmed import ─────────────────────────────────────

  const doImport = async () => {
    if (importState.phase !== "confirm") return;
    const { file } = importState;
    setImportState({ phase: "importing" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/excel/import`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || json.valid === false) {
        setImportState({
          phase: "errors",
          errors: json.errors ?? [{ column: "file", row: 0, message: json.error ?? "Import failed" }],
        });
        return;
      }

      const result = json as ImportResult;
      setImportState({ phase: "done", result });
      queryClient.invalidateQueries({ queryKey: getListBudgetLinesWithMonthlyQueryKey({ year: 2026 }) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ year: 2026 }) });
      showToast(
        result.snapshotSaved
          ? "Budget imported. A pre-import snapshot has been saved to the Snapshot Manager."
          : "Budget imported successfully."
      );
    } catch (e: unknown) {
      showToast("Import error: " + (e instanceof Error ? e.message : String(e)), "error");
      setImportState({ phase: "idle" });
    }
  };

  const reset = () => {
    setImportState({ phase: "idle" });
    setConfirmText("");
    setExpandedSections({});
  };

  const confirmEnabled = confirmText === "CONFIRM" && importState.phase === "confirm";

  // ─── Render ────────────────────────────────────────────────────────────────

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
    >
      {!isDesktop && <AdminSubnav active="excel" />}
      <SectionHeader title="Excel" subtitle="Export and import budget data" />

      {/* ─── Export card ─────────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "15" }]}>
            <Feather name="download" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Export to Excel</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Download all 27 budget lines with monthly plan and actual figures as a formatted .xlsx file
            </Text>
          </View>
        </View>

        <Text style={[styles.formatText, { color: colors.mutedForeground }]}>
          Columns: Category, Subcategory, Line Item, Owner, Region, Channel, Cost Status, Projection %, Board Approved Amount, Jan–Dec Plan, Jan–Dec Actual
        </Text>

        <TouchableOpacity
          onPress={handleExport}
          disabled={exportLoading}
          style={[styles.secondaryBtn, { borderColor: colors.primary }]}
          activeOpacity={0.7}
        >
          {exportLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="download" size={16} color={colors.primary} />
          )}
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
            {exportLoading ? "Preparing…" : "Export to Excel"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ─── Import card ─────────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconWrap, { backgroundColor: "#f59e0b15" }]}>
            <Feather name="upload" size={20} color="#f59e0b" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Import from Excel</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Upload an .xlsx file in the same format as the export. The file is validated before any data is changed.
            </Text>
          </View>
        </View>

        {/* Hidden web file input */}
        {Platform.OS === "web" && (
          <input
            ref={fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        )}

        {/* Idle / pick */}
        {importState.phase === "idle" && (
          <TouchableOpacity
            onPress={pickAndValidate}
            style={[styles.uploadArea, { borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Feather name="upload-cloud" size={28} color={colors.mutedForeground} />
            <Text style={[styles.uploadLabel, { color: colors.foreground }]}>
              {Platform.OS === "web" ? "Click to choose .xlsx file" : "Tap to choose .xlsx file"}
            </Text>
            <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>
              Only .xlsx files are accepted — not .xls, .xlsm, or CSV
            </Text>
          </TouchableOpacity>
        )}

        {/* Validating */}
        {importState.phase === "validating" && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              Checking file…
            </Text>
          </View>
        )}

        {/* Importing */}
        {importState.phase === "importing" && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              Saving and importing data…
            </Text>
          </View>
        )}

        {/* Validation errors */}
        {importState.phase === "errors" && (
          <View>
            <View style={[styles.errorBox, { backgroundColor: "#fef2f2", borderColor: "#fca5a5" }]}>
              <View style={styles.errorBoxHeader}>
                <Feather name="x-circle" size={16} color="#dc2626" />
                <Text style={[styles.errorBoxTitle, { color: "#dc2626" }]}>
                  Validation failed — {importState.errors.length} error{importState.errors.length !== 1 ? "s" : ""}
                </Text>
              </View>
              {importState.errors.map((err, i) => (
                <Text key={i} style={styles.errorItem}>
                  {err.row > 0 ? `Row ${err.row}, ` : ""}{err.column}: {err.message}
                </Text>
              ))}
              <Text style={[styles.errorHint, { color: "#991b1b" }]}>
                No data was changed. Fix the file and try again.
              </Text>
            </View>
            <TouchableOpacity
              onPress={reset}
              style={[styles.secondaryBtn, { borderColor: colors.border, marginTop: 8 }]}
              activeOpacity={0.7}
            >
              <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Try another file</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Confirm — only shown after validation passes */}
        {importState.phase === "confirm" && (
          <View>
            {/* Validation passed badge */}
            <View style={styles.validBadge}>
              <Feather name="check-circle" size={14} color="#16a34a" />
              <Text style={styles.validBadgeText}>
                File validated — {importState.rowCount} budget line{importState.rowCount !== 1 ? "s" : ""} ready to import
              </Text>
            </View>

            {/* Diff summary row */}
            <View style={styles.diffRow}>
              <TouchableOpacity
                style={styles.diffItem}
                onPress={() => importState.diff.toAdd.length > 0 && toggleSection("add")}
                activeOpacity={importState.diff.toAdd.length > 0 ? 0.7 : 1}
              >
                <Text style={[styles.diffCount, { color: "#16a34a" }]}>{importState.diff.toAdd.length}</Text>
                <Text style={styles.diffLabel}>
                  added{importState.diff.toAdd.length > 0 ? (expandedSections.add ? " ▲" : " ▼") : ""}
                </Text>
              </TouchableOpacity>
              <View style={styles.diffDivider} />
              <TouchableOpacity
                style={styles.diffItem}
                onPress={() => importState.diff.toUpdate.length > 0 && toggleSection("update")}
                activeOpacity={importState.diff.toUpdate.length > 0 ? 0.7 : 1}
              >
                <Text style={[styles.diffCount, { color: "#2563eb" }]}>{importState.diff.toUpdate.length}</Text>
                <Text style={styles.diffLabel}>
                  updated{importState.diff.toUpdate.length > 0 ? (expandedSections.update ? " ▲" : " ▼") : ""}
                </Text>
              </TouchableOpacity>
              <View style={styles.diffDivider} />
              <TouchableOpacity
                style={styles.diffItem}
                onPress={() => importState.diff.toDelete.length > 0 && toggleSection("delete")}
                activeOpacity={importState.diff.toDelete.length > 0 ? 0.7 : 1}
              >
                <Text style={[styles.diffCount, { color: importState.diff.toDelete.length > 0 ? "#dc2626" : "#6b7280" }]}>
                  {importState.diff.toDelete.length}
                </Text>
                <Text style={[styles.diffLabel, importState.diff.toDelete.length > 0 && { color: "#dc2626", fontFamily: "Inter_600SemiBold" }]}>
                  removed{importState.diff.toDelete.length > 0 ? (expandedSections.delete ? " ▲" : " ▼") : ""}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Expandable line-by-line breakdown */}
            {expandedSections.add && importState.diff.toAdd.length > 0 && (
              <View style={[styles.breakdownBox, { borderColor: "#86efac", backgroundColor: "#f0fdf4" }]}>
                <Text style={[styles.breakdownTitle, { color: "#166534" }]}>Lines to be added</Text>
                {importState.diff.toAdd.map((line, i) => (
                  <View key={i} style={styles.breakdownRow}>
                    <Feather name="plus-circle" size={13} color="#16a34a" />
                    <Text style={[styles.breakdownCategory, { color: "#15803d" }]}>{line.category}</Text>
                    <Text style={[styles.breakdownLine, { color: "#166534" }]}>{line.lineItem}</Text>
                  </View>
                ))}
              </View>
            )}

            {expandedSections.update && importState.diff.toUpdate.length > 0 && (
              <View style={[styles.breakdownBox, { borderColor: "#93c5fd", backgroundColor: "#eff6ff" }]}>
                <Text style={[styles.breakdownTitle, { color: "#1e40af" }]}>Lines to be updated</Text>
                {importState.diff.toUpdate.map((line, i) => (
                  <View key={i} style={styles.breakdownRow}>
                    <Feather name="edit-2" size={13} color="#2563eb" />
                    <Text style={[styles.breakdownCategory, { color: "#1d4ed8" }]}>{line.category}</Text>
                    <Text style={[styles.breakdownLine, { color: "#1e40af" }]}>{line.lineItem}</Text>
                  </View>
                ))}
              </View>
            )}

            {expandedSections.delete && importState.diff.toDelete.length > 0 && (
              <View style={[styles.breakdownBox, { borderColor: "#fca5a5", backgroundColor: "#fff1f2" }]}>
                <Text style={[styles.breakdownTitle, { color: "#991b1b" }]}>Lines to be permanently removed</Text>
                {importState.diff.toDelete.map((line, i) => (
                  <View key={i} style={styles.breakdownRow}>
                    <Feather name="alert-triangle" size={13} color="#dc2626" />
                    <Text style={[styles.breakdownCategory, { color: "#dc2626" }]}>{line.category}</Text>
                    <Text style={[styles.breakdownLineDeleted]}>{line.lineItem}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Warning box — escalated if any lines will be deleted */}
            <View style={[
              styles.warningBox,
              { marginTop: 12 },
              importState.diff.toDelete.length > 0 && styles.warningBoxDanger,
            ]}>
              <View style={styles.warningHeader}>
                <Feather
                  name="alert-triangle"
                  size={18}
                  color={importState.diff.toDelete.length > 0 ? "#b91c1c" : "#92400e"}
                />
                <Text style={[
                  styles.warningTitle,
                  importState.diff.toDelete.length > 0 && { color: "#b91c1c" },
                ]}>
                  {importState.diff.toDelete.length > 0
                    ? `${importState.diff.toDelete.length} line${importState.diff.toDelete.length !== 1 ? "s" : ""} will be permanently removed`
                    : "This will overwrite all current budget data"}
                </Text>
              </View>
              <Text style={styles.warningBody}>
                Importing this file will{" "}
                <Text style={{ fontFamily: "Inter_700Bold" }}>permanently replace</Text> all budget
                lines, their monthly plan figures, and all recorded actuals. This cannot be undone
                except by restoring from a snapshot.
              </Text>
              <Text style={styles.warningBody}>
                The system will attempt to save a{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>pre-import snapshot</Text> before
                writing any data.
              </Text>
            </View>

            {/* CONFIRM gate */}
            <View style={[styles.confirmGate, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.confirmLabel, { color: colors.foreground }]}>
                Type{" "}
                <Text style={{ fontFamily: "Inter_700Bold", color: "#dc2626" }}>CONFIRM</Text>{" "}
                to enable the import button:
              </Text>
              <TextInput
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="Type CONFIRM here"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                style={[
                  styles.confirmInput,
                  {
                    color: colors.foreground,
                    borderColor: confirmText === "CONFIRM" ? "#16a34a" : colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
              />
            </View>

            <View style={styles.confirmButtons}>
              <TouchableOpacity
                onPress={reset}
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={doImport}
                disabled={!confirmEnabled}
                style={[
                  styles.destructiveBtn,
                  !confirmEnabled && styles.destructiveBtnDisabled,
                ]}
                activeOpacity={confirmEnabled ? 0.7 : 1}
              >
                <Feather name="upload" size={15} color="#fff" />
                <Text style={styles.destructiveBtnText}>Yes, overwrite my budget</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Done */}
        {importState.phase === "done" && (
          <View>
            <View style={[styles.successBox, { backgroundColor: "#f0fdf4", borderColor: "#86efac" }]}>
              <View style={styles.successHeader}>
                <Feather name="check-circle" size={16} color="#16a34a" />
                <Text style={[styles.successTitle, { color: "#16a34a" }]}>Import complete</Text>
              </View>
              <Text style={[styles.successBody, { color: "#166534" }]}>
                {importState.result.message}
              </Text>
              <View style={styles.countsRow}>
                <View style={styles.countItem}>
                  <Text style={styles.countNum}>{importState.result.counts.upserted}</Text>
                  <Text style={styles.countLabel}>Updated</Text>
                </View>
                <View style={styles.countItem}>
                  <Text style={styles.countNum}>{importState.result.counts.inserted}</Text>
                  <Text style={styles.countLabel}>Added</Text>
                </View>
                <View style={styles.countItem}>
                  <Text style={styles.countNum}>{importState.result.counts.deleted}</Text>
                  <Text style={styles.countLabel}>Removed</Text>
                </View>
                <View style={styles.countItem}>
                  <Text style={styles.countNum}>{importState.result.counts.plansWritten}</Text>
                  <Text style={styles.countLabel}>Plan rows</Text>
                </View>
                <View style={styles.countItem}>
                  <Text style={styles.countNum}>{importState.result.counts.actualsWritten}</Text>
                  <Text style={styles.countLabel}>Actual rows</Text>
                </View>
              </View>
              {importState.result.snapshotSaved ? (
                <Text style={[styles.snapshotNote, { color: "#166534" }]}>
                  A pre-import snapshot was saved to the Snapshot Manager.
                </Text>
              ) : (
                <Text style={[styles.snapshotNote, { color: "#78350f" }]}>
                  Note: the pre-import snapshot could not be saved (Snapshot Manager not yet available).
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={reset}
              style={[styles.secondaryBtn, { borderColor: colors.border, marginTop: 8 }]}
              activeOpacity={0.7}
            >
              <Feather name="upload-cloud" size={14} color={colors.mutedForeground} />
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Import another file</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopRoot}>
        <DesktopSidebar alertCount={activeAlerts.length} />
        <View style={styles.desktopMain}>
          <AdminSubnav active="excel" />
          {content}
        </View>
      </View>
    );
  }

  return content;
}

// Lazy-load expo native modules to avoid web bundling issues.
// Uses expo-file-system/legacy for the string cacheDirectory + downloadAsync API.
async function loadNativeModules() {
  try {
    const [fs, sharing] = await Promise.all([
      import("expo-file-system/legacy"),
      import("expo-sharing"),
    ]);
    return { FileSystem: fs, Sharing: sharing };
  } catch {
    return { FileSystem: null, Sharing: null };
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  desktopRoot: { flex: 1, flexDirection: "row" },
  desktopMain: { flex: 1, overflow: "hidden" as const, paddingTop: 12, paddingHorizontal: 24 },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
    gap: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  cardSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  formatText: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },

  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start" as const,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  uploadArea: {
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  uploadLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  uploadSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  statusText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  errorBox: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 6 },
  errorBoxHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  errorBoxTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  errorItem: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#991b1b", paddingLeft: 24, lineHeight: 18 },
  errorHint: { fontSize: 12, fontFamily: "Inter_500Medium", paddingLeft: 24, marginTop: 4 },

  validBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#86efac",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  validBadgeText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#166534" },

  warningBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 1.5,
    borderColor: "#f59e0b",
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  warningHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  warningTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#92400e" },
  warningBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#78350f", lineHeight: 19 },
  warningBoxDanger: {
    backgroundColor: "#fff1f2",
    borderColor: "#f87171",
  },

  diffRow: {
    flexDirection: "row" as const,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  diffItem: { flex: 1, alignItems: "center", gap: 2 },
  diffCount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  diffLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  diffDivider: { width: 1, height: 32, backgroundColor: "#e5e7eb" },

  confirmGate: { marginTop: 8, borderWidth: 1, borderRadius: 8, padding: 14, gap: 8 },
  confirmLabel: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  confirmInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },

  confirmButtons: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" as const },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  destructiveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 10,
  },
  destructiveBtnDisabled: { backgroundColor: "#fca5a5" },
  destructiveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  successBox: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  successHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  successTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  successBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  countsRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" as const },
  countItem: { alignItems: "center", gap: 2, minWidth: 60 },
  countNum: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#166534" },
  countLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#166534", textAlign: "center" as const },
  snapshotNote: { fontSize: 12, fontFamily: "Inter_500Medium", fontStyle: "italic" as const },

  breakdownBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  breakdownTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  breakdownCategory: { fontSize: 11, fontFamily: "Inter_500Medium" },
  breakdownLine: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  breakdownLineDeleted: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#dc2626", flex: 1, textDecorationLine: "line-through" as const },
});
