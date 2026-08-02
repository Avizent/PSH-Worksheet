import React, { useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { AdminSubnav } from "@/components/AdminSubnav";
import { useListAlerts } from "@workspace/api-client-react";
import {
  useRunIntegrityCheck,
  type IntegrityFinding,
  type IntegritySeverity,
  type IntegrityCategory,
} from "@workspace/api-client-react/integrity";

const SEVERITY_ORDER: IntegritySeverity[] = ["critical", "warning", "info"];

const SEVERITY_META: Record<
  IntegritySeverity,
  { label: string; colour: string; icon: keyof typeof Feather.glyphMap; blurb: string }
> = {
  critical: {
    label: "Needs attention",
    colour: "#dc2626",
    icon: "alert-octagon",
    blurb: "A figure shown in the app is wrong because of this.",
  },
  warning: {
    label: "Worth a look",
    colour: "#d97706",
    icon: "alert-triangle",
    blurb: "Not necessarily wrong, but someone should decide.",
  },
  info: {
    label: "For information",
    colour: "#2563eb",
    icon: "info",
    blurb: "Nothing is broken. Listed so you know.",
  },
};

const CATEGORY_LABELS: Record<IntegrityCategory, string> = {
  "data-health": "Budget lines",
  spreadsheet: "Spreadsheet",
  calculation: "Calculations",
};

export default function IntegrityScreen() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";

  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.filter((a) => !a.resolvedAt).length ?? 0;

  const runCheck = useRunIntegrityCheck();
  const report = runCheck.data;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const allFindings: IntegrityFinding[] = report
    ? report.results.flatMap((r) => r.findings)
    : [];
  const erroredChecks = report ? report.results.filter((r) => !r.ok) : [];

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const content = (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: isDesktop ? 32 : 120 }}
    >
      {!isDesktop && <AdminSubnav active="integrity" />}
      <SectionHeader
        title="Data Integrity"
        subtitle="Check the budget data for problems that would make figures wrong"
      />

      <View style={[styles.runCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.runTitle, { color: colors.foreground }]}>Run all checks</Text>
          <Text style={[styles.runBlurb, { color: colors.mutedForeground }]}>
            Looks for duplicate budget lines, figures that do not add up, and anything that would
            stop the spreadsheet export working. Nothing is changed — you decide what to fix.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => runCheck.mutate({})}
          disabled={runCheck.isPending}
          accessibilityRole="button"
          accessibilityLabel="Check integrity"
          style={[
            styles.runButton,
            { backgroundColor: runCheck.isPending ? colors.mutedForeground : colors.primary },
          ]}
        >
          {runCheck.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="shield" size={16} color="#fff" />
          )}
          <Text style={styles.runButtonText}>
            {runCheck.isPending ? "Checking…" : "Check Integrity"}
          </Text>
        </TouchableOpacity>
      </View>

      {runCheck.isError && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#dc2626" }]}>
          <Text style={[styles.cardTitle, { color: "#dc2626" }]}>Could not run the checks</Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            {runCheck.error instanceof Error ? runCheck.error.message : "Unknown error"}
          </Text>
        </View>
      )}

      {report && (
        <>
          <View style={styles.summaryRow}>
            {SEVERITY_ORDER.map((sev) => {
              const meta = SEVERITY_META[sev];
              const count = report.summary[sev];
              return (
                <View
                  key={sev}
                  style={[
                    styles.summaryTile,
                    { backgroundColor: colors.card, borderColor: count > 0 ? meta.colour : colors.border },
                  ]}
                >
                  <Feather name={meta.icon} size={18} color={count > 0 ? meta.colour : colors.mutedForeground} />
                  <Text style={[styles.summaryCount, { color: count > 0 ? meta.colour : colors.mutedForeground }]}>
                    {count}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{meta.label}</Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.metaLine, { color: colors.mutedForeground }]}>
            {report.summary.checksRun} checks run in {(report.durationMs / 1000).toFixed(1)}s
            {report.summary.checksErrored > 0 ? ` · ${report.summary.checksErrored} could not complete` : ""}
          </Text>

          {report.summary.clean && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#16a34a" }]}>
              <View style={styles.rowCentre}>
                <Feather name="check-circle" size={20} color="#16a34a" />
                <Text style={[styles.cardTitle, { color: "#16a34a", marginBottom: 0 }]}>
                  Everything checks out
                </Text>
              </View>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                No problems found in the budget data.
              </Text>
            </View>
          )}

          {erroredChecks.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#d97706" }]}>
              <Text style={[styles.cardTitle, { color: "#d97706" }]}>Some checks could not run</Text>
              {erroredChecks.map((r) => (
                <Text key={r.id} style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  {r.id} {r.title}: {r.error}
                </Text>
              ))}
            </View>
          )}

          {SEVERITY_ORDER.map((sev) => {
            const findings = allFindings.filter((f) => f.severity === sev);
            if (findings.length === 0) return null;
            const meta = SEVERITY_META[sev];
            return (
              <View key={sev} style={{ marginTop: 20 }}>
                <View style={styles.rowCentre}>
                  <Feather name={meta.icon} size={16} color={meta.colour} />
                  <Text style={[styles.groupHeading, { color: colors.foreground }]}>
                    {meta.label} ({findings.length})
                  </Text>
                </View>
                <Text style={[styles.groupBlurb, { color: colors.mutedForeground }]}>{meta.blurb}</Text>

                {findings.map((finding, idx) => {
                  const key = `${finding.id}-${idx}`;
                  const isOpen = expanded[key] ?? false;
                  return (
                    <View
                      key={key}
                      style={[styles.finding, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={styles.findingHeader}>
                        <View style={[styles.sevDot, { backgroundColor: meta.colour }]} />
                        <Text style={[styles.findingTitle, { color: colors.foreground }]}>
                          {finding.title}
                        </Text>
                        <Text style={[styles.findingTag, { color: colors.mutedForeground }]}>
                          {CATEGORY_LABELS[finding.category]}
                        </Text>
                      </View>

                      <Text style={[styles.findingBody, { color: colors.mutedForeground }]}>
                        {finding.description}
                      </Text>

                      {finding.remediation && (
                        <View style={[styles.remediation, { backgroundColor: colors.background }]}>
                          <Feather name="tool" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.remediationText, { color: colors.foreground }]}>
                            {finding.remediation}
                          </Text>
                        </View>
                      )}

                      {finding.affected.length > 0 && (
                        <>
                          <TouchableOpacity
                            onPress={() => toggle(key)}
                            accessibilityRole="button"
                            style={styles.disclosure}
                          >
                            <Feather
                              name={isOpen ? "chevron-down" : "chevron-right"}
                              size={14}
                              color={colors.primary}
                            />
                            <Text style={[styles.disclosureText, { color: colors.primary }]}>
                              {isOpen ? "Hide" : "Show"} affected ({finding.affectedCount})
                            </Text>
                          </TouchableOpacity>

                          {isOpen &&
                            finding.affected.map((a, i) => (
                              <View
                                key={`${key}-a-${i}`}
                                style={[styles.affectedRow, { borderTopColor: colors.border }]}
                              >
                                <Text style={[styles.affectedLabel, { color: colors.foreground }]}>
                                  {a.label}
                                </Text>
                                {a.detail && (
                                  <Text style={[styles.affectedDetail, { color: colors.mutedForeground }]}>
                                    {Object.entries(a.detail)
                                      .map(([k, v]) => `${k}: ${v}`)
                                      .join("  ·  ")}
                                  </Text>
                                )}
                              </View>
                            ))}

                          {isOpen && finding.affectedCount > finding.affected.length && (
                            <Text style={[styles.affectedDetail, { color: colors.mutedForeground, marginTop: 6 }]}>
                              …and {finding.affectedCount - finding.affected.length} more
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </>
      )}

      {!report && !runCheck.isPending && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            No checks have been run yet. Press Check Integrity above.
          </Text>
        </View>
      )}
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
  rowCentre: { flexDirection: "row", alignItems: "center", gap: 8 },

  runCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  runTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  runBlurb: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  runButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  runButtonText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  summaryTile: {
    flex: 1,
    minWidth: 100,
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  summaryCount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },

  metaLine: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },

  groupHeading: { fontSize: 15, fontFamily: "Inter_700Bold" },
  groupBlurb: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 8 },

  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginTop: 12, gap: 6 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  cardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  finding: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  findingHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  findingTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  findingTag: { fontSize: 11, fontFamily: "Inter_500Medium" },
  findingBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  remediation: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  remediationText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 17 },

  disclosure: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  disclosureText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  affectedRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  affectedLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  affectedDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
});
