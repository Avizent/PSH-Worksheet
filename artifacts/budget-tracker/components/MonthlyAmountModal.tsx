import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthEntry {
  month: number;
  amount: number;
}

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  mode: "plan" | "actual";
  year: number;
  entries: MonthEntry[];
  saving?: boolean;
  onClose: () => void;
  onSave: (changes: { month: number; year: number; amount: number }[]) => void;
}

export function MonthlyAmountModal({ visible, title, subtitle, mode, year, entries, saving, onClose, onSave }: Props) {
  const colors = useColors();

  const initial = useMemo(() => {
    const map: Record<number, string> = {};
    for (let m = 1; m <= 12; m++) map[m] = "";
    for (const e of entries) map[e.month] = String(e.amount ?? 0);
    return map;
  }, [entries]);

  const [values, setValues] = useState<Record<number, string>>(initial);

  React.useEffect(() => {
    if (visible) setValues(initial);
  }, [visible, initial]);

  const handleSave = () => {
    const changes: { month: number; year: number; amount: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const before = initial[m] || "0";
      const after = values[m] || "0";
      if (parseFloat(before) !== parseFloat(after)) {
        changes.push({ month: m, year, amount: parseFloat(after) || 0 });
      }
    }
    onSave(changes);
  };

  const total = Object.values(values).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
          <Text style={[styles.modeLabel, { color: mode === "plan" ? colors.primary : colors.success }]}>
            {mode === "plan" ? "Editing planned amounts" : "Editing actual amounts"} \u00b7 FY{year}
          </Text>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.grid}>
            {MONTH_LABELS.map((label, idx) => {
              const m = idx + 1;
              return (
                <View key={m} style={[styles.cell, { borderColor: colors.border }]}>
                  <Text style={[styles.cellLabel, { color: colors.mutedForeground }]}>{label}</Text>
                  <View style={styles.inputWrap}>
                    <Text style={[styles.currency, { color: colors.mutedForeground }]}>\u00a3</Text>
                    <TextInput
                      value={values[m]}
                      onChangeText={(v) => setValues((s) => ({ ...s, [m]: v.replace(/[^0-9.\-]/g, "") }))}
                      keyboardType="numeric"
                      style={[styles.input, { color: colors.foreground }]}
                      placeholder="0"
                      placeholderTextColor={colors.mutedForeground}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total</Text>
            <Text style={[styles.totalValue, { color: colors.foreground }]}>
              \u00a3{total.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={[styles.btn, { borderColor: colors.border }]} activeOpacity={0.7}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Save changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 560, borderRadius: 14, borderWidth: 1, padding: 20 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  modeLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 6, marginBottom: 12, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "31%", borderWidth: 1, borderRadius: 8, padding: 8 },
  cellLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 4, textTransform: "uppercase" as const },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  currency: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", padding: 0 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 12, marginTop: 12, borderTopWidth: 1 },
  totalLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  totalValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16, justifyContent: "flex-end" },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, minWidth: 110, alignItems: "center" },
  btnPrimary: { borderColor: "transparent" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
