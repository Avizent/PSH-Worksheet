import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Switch,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { KpiCard } from "@/components/KpiCard";
import { BarChart } from "@/components/BarChart";
import { LineChart } from "@/components/LineChart";
import { DonutChart } from "@/components/DonutChart";
import { ProjectionBarChart } from "@/components/ProjectionBarChart";
import { EmptyState } from "@/components/EmptyState";
import {
  useListBoardSettings,
  useUpdateBoardSettings,
  useListShareTokens,
  useCreateShareToken,
  useRevokeShareToken,
  useGetBoardPreview,
  getListBoardSettingsQueryKey,
  getListShareTokensQueryKey,
  getGetBoardPreviewQueryKey,
} from "@workspace/api-client-react";
import { getApiUrl } from "@/utils/getApiUrl";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000000) return "\u00a3" + (val / 1000000).toFixed(2) + "M";
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function BoardContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useListBoardSettings();
  const { data: tokens } = useListShareTokens();
  const { data: preview, isLoading: previewLoading } = useGetBoardPreview();
  const updateSettingsMutation = useUpdateBoardSettings();
  const createTokenMutation = useCreateShareToken();
  const revokeTokenMutation = useRevokeShareToken();

  const [previewMode, setPreviewMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: getListBoardSettingsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetBoardPreviewQueryKey() });
    setRefreshing(false);
  };

  const handleToggle = (sectionKey: string, currentlyVisible: boolean) => {
    if (!settings) return;
    const updates = [{ sectionKey, visible: !currentlyVisible }];
    updateSettingsMutation.mutate(
      { data: updates },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBoardSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBoardPreviewQueryKey() });
        },
      }
    );
  };

  const handleCreateToken = () => {
    createTokenMutation.mutate(
      { data: { label: "Board Link" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListShareTokensQueryKey() });
        },
      }
    );
  };

  const handleRevokeToken = (id: number) => {
    revokeTokenMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListShareTokensQueryKey() });
        },
      }
    );
  };

  const copyTokenLink = async (token: string, tokenId: number) => {
    const baseUrl = Platform.OS === "web" ? window.location.origin : "";
    const link = `${baseUrl}/board-view?token=${token}`;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(link);
        setCopiedTokenId(tokenId);
        setTimeout(() => setCopiedTokenId(null), 2000);
      } catch {
        alert(link);
      }
    } else {
      alert(link);
    }
  };

  const handleExportPdf = () => {
    const baseUrl = getApiUrl();
    const url = `${baseUrl}/api/exports/pdf`;
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  const handleExportExcel = () => {
    const baseUrl = getApiUrl();
    const url = `${baseUrl}/api/exports/excel`;
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  const visibleSections = new Set(preview?.visibleSections || []);

  if (settingsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (previewMode || !isDesktop) {
    return renderBoardPreview();
  }

  function renderBoardPreview() {
    if (previewLoading || !preview) {
      return (
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    const s = preview.summary;
    const chartMonthly = preview.charts.monthly.map((m: { monthLabel: string; planned: number; actual: number }) => ({
      label: m.monthLabel,
      planned: m.planned,
      actual: m.actual,
    }));
    const chartCumulative = preview.charts.monthly.map((m: { monthLabel: string; cumPlanned: number; cumActual: number }) => ({
      label: m.monthLabel,
      plan: m.cumPlanned,
      actual: m.cumActual,
    }));
    const chartCategories = preview.charts.categories.map((c: { category: string; actual: number }) => ({
      label: c.category,
      value: c.actual,
    }));

    const projectionMonthly = MONTH_LABELS.map((label, i) => {
      const m = i + 1;
      let actual = 0, projected = 0, planned = 0;
      for (const item of (preview.projections?.items || [])) {
        const md = item.months.find((mo: { month: number }) => mo.month === m);
        if (md) {
          actual += md.actual || 0;
          projected += md.projected || 0;
          planned += md.planned || 0;
        }
      }
      return { label, actual, projected, planned };
    });

    const chartWidth = isDesktop ? 500 : 340;

    return (
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.previewContent, { paddingHorizontal: isDesktop ? 40 : 16, paddingTop: isDesktop ? 32 : 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {isDesktop && previewMode && (
          <TouchableOpacity
            onPress={() => setPreviewMode(false)}
            style={[styles.backButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="arrow-left" size={16} color="#fff" />
            <Text style={styles.backButtonText}>Exit Preview</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.boardTitle, { color: colors.foreground }]}>Hubert Marketing Budget</Text>
        <Text style={[styles.boardSubtitle, { color: colors.mutedForeground }]}>FY2026 Board Report</Text>

        {(visibleSections.has("kpi_total_budget") || visibleSections.has("kpi_spent_ytd") || visibleSections.has("kpi_remaining") || visibleSections.has("kpi_fixed_run_rate")) && (
          <View style={[styles.kpiRow, { flexDirection: isDesktop ? "row" : "column" }]}>
            {visibleSections.has("kpi_total_budget") && <KpiCard icon="target" label="TOTAL BUDGET" value={formatCurrency(s.totalBudget)} />}
            {visibleSections.has("kpi_spent_ytd") && <KpiCard icon="credit-card" label="SPENT YTD" value={formatCurrency(s.spentYtd)} />}
            {visibleSections.has("kpi_remaining") && <KpiCard icon="check-circle" label="REMAINING" value={formatCurrency(s.remaining)} />}
            {visibleSections.has("kpi_fixed_run_rate") && <KpiCard icon="repeat" label="FIXED RUN RATE" value={formatCurrency(s.fixedRunRate) + "/mo"} />}
          </View>
        )}

        {visibleSections.has("chart_plan_vs_actual") && (
          <View style={styles.section}>
            <SectionHeader title="Plan vs Actual (Monthly)" />
            <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <BarChart data={chartMonthly} width={chartWidth} height={260} />
            </View>
          </View>
        )}

        {visibleSections.has("chart_cumulative") && (
          <View style={styles.section}>
            <SectionHeader title="Cumulative Spend vs Plan" />
            <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <LineChart data={chartCumulative} width={chartWidth} height={260} />
            </View>
          </View>
        )}

        {visibleSections.has("chart_categories") && (
          <View style={styles.section}>
            <SectionHeader title="Category Breakdown" />
            <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <DonutChart data={chartCategories} size={220} />
            </View>
          </View>
        )}

        {visibleSections.has("chart_projections") && (
          <View style={styles.section}>
            <SectionHeader title="Projections" />
            <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ProjectionBarChart data={projectionMonthly} width={chartWidth} height={260} />
            </View>
          </View>
        )}

        {visibleSections.has("section_alerts") && preview.alerts.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Active Alerts" subtitle={`${preview.alerts.length} alert${preview.alerts.length !== 1 ? "s" : ""}`} />
            {preview.alerts.map((a: { id: number; severity: string; type: string; message: string }) => (
              <View key={a.id} style={[styles.alertItem, { backgroundColor: a.severity === "critical" ? "#fee2e220" : "#fef3c720", borderColor: colors.border }]}>
                <View style={[styles.alertBadge, { backgroundColor: a.severity === "critical" ? "#fee2e2" : "#fef3c7" }]}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: a.severity === "critical" ? "#dc2626" : "#d97706" }}>
                    {a.type.toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.alertMessage, { color: colors.foreground }]}>{a.message}</Text>
              </View>
            ))}
          </View>
        )}

        {visibleSections.has("section_events") && preview.events.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Marketing Events" />
            {preview.events.map((e: { id: number; name: string; status: string; estimatedCost?: number | null; eventDate?: string | null }) => (
              <View key={e.id} style={[styles.eventRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventName, { color: colors.foreground }]}>{e.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                    {e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "TBD"} · {e.status}
                  </Text>
                </View>
                {e.estimatedCost != null && (
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{formatCurrency(e.estimatedCost)}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {!isDesktop && (
          <View style={styles.mobileExportSection}>
            <Text style={[styles.mobileExportTitle, { color: colors.foreground }]}>Export Report</Text>
            <View style={styles.mobileExportRow}>
              <TouchableOpacity
                onPress={handleExportPdf}
                style={[styles.mobileExportButton, { backgroundColor: colors.foreground }]}
              >
                <Feather name="file-text" size={18} color="#fff" />
                <Text style={styles.mobileExportButtonText}>Download PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleExportExcel}
                style={[styles.mobileExportButton, { backgroundColor: "#16a34a" }]}
              >
                <Feather name="download" size={18} color="#fff" />
                <Text style={styles.mobileExportButtonText}>Download Excel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    );
  }

  const activeTokens = tokens?.filter((t: { revoked: boolean }) => !t.revoked) || [];

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <SectionHeader title="Board View Settings" subtitle="Control what board members and the CFO can see" />

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={() => setPreviewMode(true)}
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
        >
          <Feather name="eye" size={16} color="#fff" />
          <Text style={styles.actionButtonText}>Preview as Board</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleExportPdf}
          style={[styles.actionButton, { backgroundColor: colors.foreground }]}
        >
          <Feather name="file-text" size={16} color="#fff" />
          <Text style={styles.actionButtonText}>Export PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleExportExcel}
          style={[styles.actionButton, { backgroundColor: "#16a34a" }]}
        >
          <Feather name="download" size={16} color="#fff" />
          <Text style={styles.actionButtonText}>Export Excel</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Visibility Controls</Text>
        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Toggle which sections appear in the board view</Text>

        {settings?.map((setting: { id: number; sectionKey: string; label: string; visible: boolean }) => (
          <View key={setting.id} style={[styles.settingRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>{setting.label}</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{setting.sectionKey}</Text>
            </View>
            <Switch
              value={setting.visible}
              onValueChange={() => handleToggle(setting.sectionKey, setting.visible)}
              trackColor={{ false: colors.muted, true: colors.primary + "50" }}
              thumbColor={setting.visible ? colors.primary : "#f4f3f4"}
            />
          </View>
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 20 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Share Links</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Generate token links for board members</Text>
          </View>
          <TouchableOpacity
            onPress={handleCreateToken}
            style={[styles.smallButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>New Link</Text>
          </TouchableOpacity>
        </View>

        {activeTokens.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13, paddingVertical: 12 }}>No active share links. Create one to share the board view.</Text>
        ) : (
          activeTokens.map((t: { id: number; token: string; label: string; createdAt: string; expiresAt?: string | null }) => (
            <View key={t.id} style={[styles.tokenRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tokenLabel, { color: colors.foreground }]}>{t.label}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "monospace" }} numberOfLines={1}>
                  ...{t.token.slice(-12)}
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                  Created {new Date(t.createdAt).toLocaleDateString("en-GB")}
                  {t.expiresAt ? ` · Expires ${new Date(t.expiresAt).toLocaleDateString("en-GB")}` : " · No expiry"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TouchableOpacity
                  onPress={() => copyTokenLink(t.token, t.id)}
                  style={[styles.iconButton, { backgroundColor: copiedTokenId === t.id ? "#16a34a" : colors.primary }]}
                >
                  <Feather name={copiedTokenId === t.id ? "check" : "copy"} size={14} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRevokeToken(t.id)}
                  style={[styles.iconButton, { backgroundColor: colors.destructive }]}
                >
                  <Feather name="x" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return content;
}

export default function BoardScreen() {
  return <BoardContent />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
    gap: 16,
  },
  previewContent: {
    paddingBottom: 40,
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  cardSubtitle: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  smallButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  tokenLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  boardTitle: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 2,
  },
  boardSubtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  kpiRow: {
    gap: 12,
    marginBottom: 8,
  },
  section: {
    marginTop: 16,
  },
  chartCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  alertItem: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  alertBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 13,
    lineHeight: 18,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  eventName: {
    fontSize: 14,
    fontWeight: "600",
  },
  mobileExportSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  mobileExportTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  mobileExportRow: {
    flexDirection: "row",
    gap: 10,
  },
  mobileExportButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  mobileExportButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
