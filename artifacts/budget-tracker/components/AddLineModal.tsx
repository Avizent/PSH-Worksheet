import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

const COST_STATUSES = ["Fixed Cost", "Variable", "Planned", "Booked"];
const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "partner", label: "Partner" },
  { value: "reseller", label: "Reseller" },
  { value: "distributor", label: "Distributor" },
  { value: "referral", label: "Referral" },
];

interface Owner { id: number; name: string; initials: string; color: string }

interface Props {
  visible: boolean;
  categories: string[];
  owners: Owner[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (data: { lineItem: string; category: string; owner?: string; costStatus: string; region?: string; channel?: string | null }) => void;
}

export function AddLineModal({ visible, categories, owners, saving, onClose, onSubmit }: Props) {
  const colors = useColors();
  const [lineItem, setLineItem] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [owner, setOwner] = useState<string>("");
  const [costStatus, setCostStatus] = useState("Variable");
  const [region, setRegion] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setLineItem(""); setCategory(""); setNewCategory(""); setOwner(""); setCostStatus("Variable"); setRegion(""); setChannel(""); setError(null);
    }
  }, [visible]);

  const finalCategory = category === "__new__" ? newCategory.trim() : category;

  const handleSubmit = () => {
    if (!lineItem.trim()) { setError("Line item is required"); return; }
    if (!finalCategory) { setError("Category is required"); return; }
    if (!costStatus) { setError("Cost status is required"); return; }
    setError(null);
    onSubmit({
      lineItem: lineItem.trim(),
      category: finalCategory,
      owner: owner || undefined,
      costStatus,
      region: region.trim() || undefined,
      channel: channel || null,
    });
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Add Budget Line</Text>
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 14 }}>
            <Field label="Line item *" colors={colors}>
              <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} value={lineItem} onChangeText={setLineItem} placeholder="e.g. LinkedIn Ads" placeholderTextColor={colors.mutedForeground} />
            </Field>

            <Field label="Category *" colors={colors}>
              <ChipPicker options={[...categories.map((c) => ({ value: c, label: c })), { value: "__new__", label: "+ New category…" }]} value={category} onChange={setCategory} colors={colors} />
              {category === "__new__" && (
                <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.border, marginTop: 8 }]} value={newCategory} onChangeText={setNewCategory} placeholder="New category name" placeholderTextColor={colors.mutedForeground} />
              )}
            </Field>

            <Field label="Owner" colors={colors}>
              {owners.length > 0 ? (
                <ChipPicker options={[{ value: "", label: "None" }, ...owners.map((o) => ({ value: o.name, label: o.name, color: o.color }))]} value={owner} onChange={setOwner} colors={colors} />
              ) : (
                <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} value={owner} onChangeText={setOwner} placeholder="Owner name (free text)" placeholderTextColor={colors.mutedForeground} />
              )}
            </Field>

            <Field label="Cost status *" colors={colors}>
              <ChipPicker options={COST_STATUSES.map((s) => ({ value: s, label: s }))} value={costStatus} onChange={setCostStatus} colors={colors} />
            </Field>

            <Field label="Region" colors={colors}>
              <TextInput style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} value={region} onChangeText={setRegion} placeholder="e.g. Global, EMEA" placeholderTextColor={colors.mutedForeground} />
            </Field>

            <Field label="Channel" colors={colors}>
              <ChipPicker options={CHANNEL_OPTIONS} value={channel} onChange={setChannel} colors={colors} />
            </Field>

            {error && <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text>}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={[styles.btn, { borderColor: colors.border }]} activeOpacity={0.7}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} disabled={saving} style={[styles.btn, { backgroundColor: colors.primary, borderColor: "transparent", opacity: saving ? 0.6 : 1 }]} activeOpacity={0.7}>
              {saving ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Add line</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Field({ label, children, colors }: { label: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

interface ChipOption { value: string; label: string; color?: string }
function ChipPicker({ options, value, onChange, colors }: { options: ChipOption[]; value: string; onChange: (v: string) => void; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity key={opt.value || "_none"} onPress={() => onChange(opt.value)} style={[styles.chip, { borderColor: colors.border }, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]} activeOpacity={0.7}>
            {opt.color && <View style={[styles.dot, { backgroundColor: opt.color }]} />}
            <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]} numberOfLines={1}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 520, borderRadius: 14, borderWidth: 1, padding: 20 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 14 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_500Medium" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: 6 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18, justifyContent: "flex-end" },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, minWidth: 110, alignItems: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
