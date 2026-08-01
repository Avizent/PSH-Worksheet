import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { AdminSubnav } from "@/components/AdminSubnav";
import { useListAlerts } from "@workspace/api-client-react";
import {
  useExchangeRate,
  useSetExchangeRate,
  useLookupExchangeRate,
} from "@workspace/api-client-react/exchange-rate";

type Mode = "manual" | "lookup";

function ExchangeRateContent() {
  const colors = useColors();
  const { mode: layoutMode } = useLayout();
  const isDesktop = layoutMode === "desktop";

  const { data, isLoading, refetch } = useExchangeRate();
  const setRate = useSetExchangeRate();
  const lookup = useLookupExchangeRate();

  const [mode, setMode] = useState<Mode>("manual");
  const [rateInput, setRateInput] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const active = data?.active ?? null;
  const history = data?.history ?? [];

  const handleLookup = async () => {
    setStatus(null);
    try {
      const result = await lookup.mutateAsync();
      setRateInput(String(result.rate));
      setStatus({
        kind: "ok",
        text: `Fetched today's rate (${result.rate}${result.date ? `, as of ${result.date}` : ""}). Review it, then Save.`,
      });
    } catch (e) {
      setMode("manual");
      setStatus({
        kind: "error",
        text: e instanceof Error ? e.message : "Lookup failed. Enter the rate manually.",
      });
    }
  };

  const handleSave = async () => {
    const parsed = Number(rateInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus({ kind: "error", text: "Enter a positive number for the rate." });
      return;
    }
    setStatus(null);
    try {
      const result = await setRate.mutateAsync({
        rate: parsed,
        source: mode,
        note: note.trim() || null,
      });
      setNote("");
      setStatus({
        kind: "ok",
        text: `Rate set to ${result.active.rate}.${result.snapshotId ? ` Snapshot "${result.snapshotId}" saved as a restore point.` : ""}`,
      });
      await refetch();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "Could not save the rate." });
    }
  };

  const { data: alerts } = useListAlerts();
  const alertCount = alerts?.length ?? 0;

  const content = (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {!isDesktop && <AdminSubnav active="exchange-rate" />}
        <SectionHeader
          title="Exchange Rate"
          subtitle="Budget figures are stored in Swedish kronor. This rate is used only to display them in pounds."
        />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>CURRENT RATE</Text>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : active ? (
            <>
              <Text style={[styles.bigRate, { color: colors.foreground }]}>
                1 GBP = {active.rate} SEK
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Set {new Date(active.createdAt).toLocaleString("en-GB")} · {active.source}
                {active.note ? ` · ${active.note}` : ""}
              </Text>
            </>
          ) : (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              No rate set yet. Figures show in kronor until one is configured.
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>SET A NEW RATE</Text>

          <View style={[styles.segment, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            {(["manual", "lookup"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => {
                  setMode(m);
                  setStatus(null);
                }}
                activeOpacity={0.7}
                style={[
                  styles.segmentOption,
                  mode === m && { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: mode === m ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {m === "manual" ? "Enter manually" : "Look up today's rate"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === "lookup" && (
            <TouchableOpacity
              onPress={handleLookup}
              disabled={lookup.isPending}
              activeOpacity={0.8}
              style={[styles.lookupBtn, { borderColor: colors.border, opacity: lookup.isPending ? 0.6 : 1 }]}
            >
              {lookup.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="download-cloud" size={14} color={colors.primary} />
                  <Text style={[styles.lookupBtnText, { color: colors.primary }]}>
                    Fetch current GBP → SEK rate
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>SEK PER 1 GBP</Text>
          <TextInput
            value={rateInput}
            onChangeText={(v) => setRateInput(v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="12.8363"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>NOTE (OPTIONAL)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Why is this changing?"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
          />

          <Text style={[styles.warning, { color: colors.mutedForeground }]}>
            Saving takes a snapshot of current budget data first, records the change in the audit
            log, and updates every figure shown in pounds.
          </Text>

          <TouchableOpacity
            onPress={handleSave}
            disabled={setRate.isPending}
            activeOpacity={0.8}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: setRate.isPending ? 0.6 : 1 }]}
          >
            {setRate.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save rate</Text>
            )}
          </TouchableOpacity>

          {status && (
            <Text
              style={[
                styles.status,
                { color: status.kind === "ok" ? colors.success : colors.destructive },
              ]}
            >
              {status.text}
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>HISTORY</Text>
          {history.length === 0 ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>No rate changes recorded yet.</Text>
          ) : (
            history.map((row) => (
              <View key={row.id} style={[styles.historyRow, { borderColor: colors.border }]}>
                <Text style={[styles.historyRate, { color: colors.foreground }]}>{row.rate}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {new Date(row.createdAt).toLocaleString("en-GB")} · {row.source}
                  </Text>
                  {row.note ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{row.note}</Text>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
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

export default function ExchangeRateScreen() {
  return <ExchangeRateContent />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  desktopLayout: { flex: 1, flexDirection: "row" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 6 },
  cardLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  bigRate: { fontSize: 22, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  segment: { flexDirection: "row", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, padding: 2, marginBottom: 8 },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
  },
  segmentText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  lookupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  lookupBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  warning: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 12, lineHeight: 16 },
  saveBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  status: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 10, lineHeight: 17 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  historyRate: { fontSize: 15, fontFamily: "Inter_600SemiBold", minWidth: 70 },
});
