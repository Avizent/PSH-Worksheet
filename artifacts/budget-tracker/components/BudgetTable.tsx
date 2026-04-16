import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Platform, TextInput, TouchableOpacity, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { InlineText, PickerCell, StatusBadge, nextStatus, type PickerOption } from "@/components/InlineEdits";

export interface BudgetLineRow {
  id: number;
  category: string;
  lineItem: string;
  owner: string | null;
  costStatus: string;
  totalPlan: number;
  totalActual: number;
  variance: number;
  projectionPct?: number;
}

interface Owner { id: number; name: string; initials: string; color: string }

export type SortField = "lineItem" | "category" | "owner" | "costStatus" | "totalPlan" | "totalActual" | "variance";
export type SortDir = "asc" | "desc" | null;

interface BudgetTableProps {
  data: BudgetLineRow[];
  showProjection?: boolean;
  onProjectionChange?: (lineId: number, value: string) => void;
  sortField: SortField | null;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  categories: string[];
  owners: Owner[];
  amountColumnMode: "plan" | "actual";
  onUpdateField: (id: number, field: "lineItem" | "category" | "owner" | "costStatus", value: string) => void;
  onOpenMonthly: (id: number, lineItem: string, mode: "plan" | "actual") => void;
  onDelete: (id: number, lineItem: string) => void;
}

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000) return "\u00a3" + (val / 1000).toFixed(1) + "k";
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function SortHeader({ label, field, sortField, sortDir, onSort, style, colors }: {
  label: string; field: SortField; sortField: SortField | null; sortDir: SortDir;
  onSort: (f: SortField) => void; style?: any; colors: ReturnType<typeof useColors>;
}) {
  const active = sortField === field && sortDir;
  return (
    <TouchableOpacity onPress={() => onSort(field)} style={[styles.sortHeader, style]} activeOpacity={0.6}>
      <Text style={[styles.headerText, { color: active ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>{label}</Text>
      {active && (
        <Feather name={sortDir === "asc" ? "chevron-up" : "chevron-down"} size={12} color={colors.foreground} />
      )}
    </TouchableOpacity>
  );
}

export function confirmDelete(title: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`Delete "${title}"? You can undo this within 5 seconds.`)) onConfirm();
  } else {
    Alert.alert("Delete budget line", `Delete "${title}"? You can undo this within 5 seconds.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onConfirm },
    ]);
  }
}

function InlineProjectionInput({ lineId, value, onSave, colors }: { lineId: number; value: number; onSave: (lineId: number, val: string) => void; colors: ReturnType<typeof useColors> }) {
  const [localVal, setLocalVal] = useState(String(value));
  React.useEffect(() => { setLocalVal(String(value)); }, [value]);
  return (
    <View style={styles.projInputContainer}>
      <TextInput style={[styles.projInput, { color: colors.foreground, borderColor: colors.border }]} value={localVal} onChangeText={setLocalVal} onBlur={() => { if (localVal !== String(value)) onSave(lineId, localVal); }} keyboardType="numeric" />
      <Text style={[styles.projPct, { color: colors.mutedForeground }]}>%</Text>
    </View>
  );
}

export function BudgetTable({ data, showProjection, onProjectionChange, sortField, sortDir, onSort, categories, owners, amountColumnMode, onUpdateField, onOpenMonthly, onDelete }: BudgetTableProps) {
  const colors = useColors();

  const categoryOptions: PickerOption[] = categories.map((c) => ({ value: c, label: c }));
  const ownerOptions: PickerOption[] = [{ value: "", label: "— None —" }, ...owners.map((o) => ({ value: o.name, label: o.name, color: o.color }))];

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === "web"}>
        <View>
          <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
            <SortHeader label="Line Item" field="lineItem" sortField={sortField} sortDir={sortDir} onSort={onSort} style={styles.cellCategory} colors={colors} />
            <SortHeader label="Category" field="category" sortField={sortField} sortDir={sortDir} onSort={onSort} style={styles.cellSmall} colors={colors} />
            <SortHeader label="Owner" field="owner" sortField={sortField} sortDir={sortDir} onSort={onSort} style={styles.cellSmall} colors={colors} />
            <SortHeader label="Type" field="costStatus" sortField={sortField} sortDir={sortDir} onSort={onSort} style={styles.cellSmall} colors={colors} />
            <SortHeader label={amountColumnMode === "plan" ? "Plan ✎" : "Plan"} field="totalPlan" sortField={sortField} sortDir={sortDir} onSort={onSort} style={[styles.cellNumber, { justifyContent: "flex-end" }]} colors={colors} />
            <SortHeader label={amountColumnMode === "actual" ? "Actual ✎" : "Actual"} field="totalActual" sortField={sortField} sortDir={sortDir} onSort={onSort} style={[styles.cellNumber, { justifyContent: "flex-end" }]} colors={colors} />
            <SortHeader label="Variance" field="variance" sortField={sortField} sortDir={sortDir} onSort={onSort} style={[styles.cellNumber, { justifyContent: "flex-end" }]} colors={colors} />
            <Text style={[styles.cellVarPct, styles.headerText, { color: colors.mutedForeground }]}>Var %</Text>
            {showProjection && <Text style={[styles.cellProjection, styles.headerText, { color: colors.mutedForeground }]}>Proj %</Text>}
            <Text style={[styles.cellAction, styles.headerText, { color: colors.mutedForeground }]}> </Text>
          </View>
          {data.map((row) => {
            const varianceColor = row.variance > 0 ? colors.success : row.variance < 0 ? colors.destructive : colors.foreground;
            return (
              <View key={row.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <InlineText value={row.lineItem} onSave={(v) => onUpdateField(row.id, "lineItem", v)} colors={colors} style={styles.cellCategory} />
                <PickerCell value={row.category} options={categoryOptions} onSelect={(v) => onUpdateField(row.id, "category", v)} colors={colors} style={styles.cellSmall} placeholder="—" allowNew newLabel="+ New category…" onCreateNew={(v) => onUpdateField(row.id, "category", v)} />
                <PickerCell value={row.owner} options={ownerOptions} onSelect={(v) => onUpdateField(row.id, "owner", v)} colors={colors} style={styles.cellSmall} placeholder="—" withDots freeTextFallback />
                <View style={styles.cellSmall}>
                  <StatusBadge status={row.costStatus} onCycle={() => onUpdateField(row.id, "costStatus", nextStatus(row.costStatus))} colors={colors} />
                </View>
                {amountColumnMode === "plan" ? (
                  <TouchableOpacity onPress={() => onOpenMonthly(row.id, row.lineItem, "plan")} activeOpacity={0.6} style={styles.cellNumber}>
                    <Text style={[{ color: colors.primary, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right", textDecorationLine: "underline", textDecorationStyle: "dotted" }]}>{formatCurrency(row.totalPlan)}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.cellNumber}>
                    <Text style={[{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right" }]}>{formatCurrency(row.totalPlan)}</Text>
                  </View>
                )}
                {amountColumnMode === "actual" ? (
                  <TouchableOpacity onPress={() => onOpenMonthly(row.id, row.lineItem, "actual")} activeOpacity={0.6} style={styles.cellNumber}>
                    <Text style={[{ color: colors.success, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right", textDecorationLine: "underline", textDecorationStyle: "dotted" }]}>{formatCurrency(row.totalActual)}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.cellNumber}>
                    <Text style={[{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right" }]}>{formatCurrency(row.totalActual)}</Text>
                  </View>
                )}
                <Text style={[styles.cellNumber, { color: varianceColor, fontSize: 13, fontFamily: "Inter_500Medium" }]}>{formatCurrency(row.variance)}</Text>
                <Text style={[styles.cellVarPct, { color: row.variance >= 0 ? colors.success : colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                  {row.totalPlan > 0 ? ((row.variance / row.totalPlan) * 100).toFixed(1) + "%" : "-"}
                </Text>
                {showProjection && (
                  <View style={styles.cellProjection}>
                    {row.costStatus === "Fixed Cost" && onProjectionChange ? (
                      <InlineProjectionInput lineId={row.id} value={row.projectionPct ?? 0} onSave={onProjectionChange} colors={colors} />
                    ) : (
                      <Text style={[styles.projDash, { color: colors.mutedForeground }]}>-</Text>
                    )}
                  </View>
                )}
                <View style={styles.cellAction}>
                  <TouchableOpacity onPress={() => confirmDelete(row.lineItem, () => onDelete(row.id, row.lineItem))} hitSlop={8} activeOpacity={0.6}>
                    <Feather name="trash-2" size={15} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, overflow: "hidden" },
  headerRow: { flexDirection: "row", borderBottomWidth: 2, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  row: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  headerText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  sortHeader: { flexDirection: "row", alignItems: "center", gap: 2 },
  cellCategory: { width: 180, paddingRight: 8 },
  cellSmall: { width: 120, paddingRight: 8 },
  cellNumber: { width: 90, paddingRight: 8, alignItems: "flex-end", justifyContent: "center" },
  cellVarPct: { width: 65, fontSize: 13, textAlign: "right" as const, paddingRight: 8 },
  cellProjection: { width: 80, paddingRight: 8, justifyContent: "center" },
  cellAction: { width: 36, alignItems: "center" },
  projInputContainer: { flexDirection: "row", alignItems: "center", gap: 2 },
  projInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, width: 50, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right" as const },
  projPct: { fontSize: 12, fontFamily: "Inter_400Regular" },
  projDash: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" as const },
});
