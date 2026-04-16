import React, { useState, useMemo } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { useListAuditLogs, useListAlerts } from "@workspace/api-client-react";

interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  userId?: number | null;
  createdAt: string;
}

interface AuditLogsData {
  entries: AuditEntry[];
  total: number;
}

const ENTITY_LABELS: Record<string, string> = {
  budget_line: "Budget Line",
  monthly_plan: "Monthly Plan",
  monthly_actual: "Monthly Actual",
  forecast_version: "Forecast Version",
  annual_rollover: "Annual Rollover",
  board_setting: "Board Setting",
  share_token: "Share Token",
  csv_import: "CSV Import",
};

const ACTION_COLORS: Record<string, string> = {
  create: "#16a34a",
  update: "#2563eb",
  delete: "#dc2626",
  rollover: "#7c3aed",
};

type DateFilter = "all" | "today" | "week" | "month";

export default function AuditScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";

  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (dateFilter) {
      case "today": {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return { startDate: start.toISOString() };
      }
      case "week": {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start.setDate(start.getDate() - 7);
        return { startDate: start.toISOString() };
      }
      case "month": {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start.setMonth(start.getMonth() - 1);
        return { startDate: start.toISOString() };
      }
      default:
        return {};
    }
  }, [dateFilter]);

  const queryParams: Record<string, string | number> = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...dateRange,
    ...(entityFilter ? { entityType: entityFilter } : {}),
  };

  const { data, isLoading, isError, refetch } = useListAuditLogs(queryParams);
  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const typedData = data as AuditLogsData | undefined;
  const entries: AuditEntry[] = typedData?.entries ?? [];
  const total = typedData?.total ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => refetch()} />}
    >
      <SectionHeader title="Audit Log" subtitle="Change history and activity trail" />

      <View style={[styles.filterBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.filterGroup}>
          {(["all", "today", "week", "month"] as DateFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => { setDateFilter(f); setPage(0); }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: dateFilter === f ? colors.primary : colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: dateFilter === f ? "#fff" : colors.foreground,
              }}>
                {f === "all" ? "All Time" : f === "today" ? "Today" : f === "week" ? "This Week" : "This Month"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {isDesktop && (
          <View style={styles.filterGroup}>
            {["", "budget_line", "monthly_plan", "forecast_version", "annual_rollover"].map((et) => (
              <TouchableOpacity
                key={et}
                onPress={() => { setEntityFilter(et); setPage(0); }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: entityFilter === et ? colors.primary : colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={{
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                  color: entityFilter === et ? "#fff" : colors.foreground,
                }}>
                  {et === "" ? "All Types" : ENTITY_LABELS[et] ?? et}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : isError ? (
        <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="alert-circle" size={32} color="#dc2626" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Failed to load audit logs</Text>
          <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>Check your connection and try again.</Text>
          <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="file-text" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No audit entries</Text>
          <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
            Changes to budget data will appear here automatically.
          </Text>
        </View>
      ) : isDesktop ? (
        <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.tableRow, styles.tableHeader, { backgroundColor: colors.muted }]}>
            <Text style={[styles.thCell, { color: colors.foreground, width: 160 }]}>Date</Text>
            <Text style={[styles.thCell, { color: colors.foreground, width: 80 }]}>Action</Text>
            <Text style={[styles.thCell, { color: colors.foreground, width: 120 }]}>Entity</Text>
            <Text style={[styles.thCell, { color: colors.foreground, width: 60 }]}>ID</Text>
            <Text style={[styles.thCell, { color: colors.foreground, width: 100 }]}>Field</Text>
            <Text style={[styles.thCell, { color: colors.foreground, flex: 1 }]}>Old Value</Text>
            <Text style={[styles.thCell, { color: colors.foreground, flex: 1 }]}>New Value</Text>
          </View>
          {entries.map((e) => (
            <View key={e.id} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tdCell, { color: colors.mutedForeground, width: 160 }]}>{formatDate(e.createdAt)}</Text>
              <View style={{ width: 80 }}>
                <View style={[styles.actionBadge, { backgroundColor: (ACTION_COLORS[e.action] ?? colors.primary) + "15" }]}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: ACTION_COLORS[e.action] ?? colors.primary }}>
                    {e.action}
                  </Text>
                </View>
              </View>
              <Text style={[styles.tdCell, { color: colors.foreground, width: 120 }]}>{ENTITY_LABELS[e.entityType] ?? e.entityType}</Text>
              <Text style={[styles.tdCell, { color: colors.mutedForeground, width: 60 }]}>#{e.entityId}</Text>
              <Text style={[styles.tdCell, { color: colors.foreground, width: 100 }]}>{e.field}</Text>
              <Text style={[styles.tdCell, { color: "#dc2626", flex: 1 }]} numberOfLines={1}>{e.oldValue ?? "—"}</Text>
              <Text style={[styles.tdCell, { color: "#16a34a", flex: 1 }]} numberOfLines={1}>{e.newValue ?? "—"}</Text>
            </View>
          ))}
          {(hasMore || page > 0) && (
            <View style={styles.paginationRow}>
              <TouchableOpacity
                onPress={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={[styles.pageButton, { borderColor: colors.border, opacity: page === 0 ? 0.4 : 1 }]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>Previous</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </Text>
              <TouchableOpacity
                onPress={() => setPage(p => p + 1)}
                disabled={!hasMore}
                style={[styles.pageButton, { borderColor: colors.border, opacity: hasMore ? 1 : 0.4 }]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        <View>
          {entries.map((e) => (
            <TouchableOpacity
              key={e.id}
              onPress={() => setSelectedEntry(e)}
              style={[styles.mobileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.mobileCardHeader}>
                <View style={[styles.actionBadge, { backgroundColor: (ACTION_COLORS[e.action] ?? colors.primary) + "15" }]}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: ACTION_COLORS[e.action] ?? colors.primary }}>
                    {e.action}
                  </Text>
                </View>
                <Text style={[styles.mobileDate, { color: colors.mutedForeground }]}>{formatDate(e.createdAt)}</Text>
              </View>
              <Text style={[styles.mobileEntityText, { color: colors.foreground }]}>
                {ENTITY_LABELS[e.entityType] ?? e.entityType} #{e.entityId}
              </Text>
              <Text style={[styles.mobileFieldText, { color: colors.mutedForeground }]}>
                {e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}
              </Text>
            </TouchableOpacity>
          ))}
          {(hasMore || page > 0) && (
            <View style={styles.paginationRow}>
              <TouchableOpacity
                onPress={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={[styles.pageButton, { borderColor: colors.border, opacity: page === 0 ? 0.4 : 1 }]}
              >
                <Text style={{ color: colors.foreground, fontSize: 12 }}>Previous</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</Text>
              <TouchableOpacity
                onPress={() => setPage(p => p + 1)}
                disabled={!hasMore}
                style={[styles.pageButton, { borderColor: colors.border, opacity: hasMore ? 1 : 0.4 }]}
              >
                <Text style={{ color: colors.foreground, fontSize: 12 }}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <Modal visible={!!selectedEntry} transparent animationType="slide" onRequestClose={() => setSelectedEntry(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedEntry(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={styles.modalHandle}>
              <View style={[styles.handleBar, { backgroundColor: colors.border }]} />
            </View>
            {selectedEntry && (
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Audit Detail</Text>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Date</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{formatDate(selectedEntry.createdAt)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Action</Text>
                  <Text style={[styles.detailValue, { color: ACTION_COLORS[selectedEntry.action] ?? colors.foreground }]}>{selectedEntry.action}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Entity</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{ENTITY_LABELS[selectedEntry.entityType] ?? selectedEntry.entityType} #{selectedEntry.entityId}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Field</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{selectedEntry.field}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Old Value</Text>
                  <Text style={[styles.detailValue, { color: "#dc2626" }]}>{selectedEntry.oldValue ?? "—"}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>New Value</Text>
                  <Text style={[styles.detailValue, { color: "#16a34a" }]}>{selectedEntry.newValue ?? "—"}</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
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
  filterBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  filterGroup: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySubtext: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  tableCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1 },
  tableHeader: { borderBottomWidth: 2 },
  thCell: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  tdCell: { fontFamily: "Inter_400Regular", fontSize: 12 },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 12,
  },
  pageButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  mobileCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  mobileCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  mobileDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  mobileEntityText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mobileFieldText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHandle: { alignItems: "center", marginBottom: 16 },
  handleBar: { width: 36, height: 4, borderRadius: 2 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  detailLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  detailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", maxWidth: "60%" },
});
