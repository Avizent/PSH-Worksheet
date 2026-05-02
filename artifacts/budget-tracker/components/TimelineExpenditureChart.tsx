import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G, Defs, Pattern, Path } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

export type TimelineCategory = {
  category: string;
  planned: number;
  spent: number;
  plannedStartMonth: number;
  plannedEndMonth: number;
};

interface TimelineExpenditureChartProps {
  categories: TimelineCategory[];
  currentMonth: number;
  width: number;
  title?: string;
  subtitle?: string;
  interactive?: boolean;
  expandedCategory?: string | null;
  onCategoryPress?: (category: string) => void;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortCurrency(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1000000) return `\u00a3${(val / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `\u00a3${Math.round(val / 1000)}k`;
  return `\u00a3${Math.round(val)}`;
}

function statusFor(plannedYtd: number, spent: number, planned: number, colors: ReturnType<typeof useColors>) {
  if (planned <= 0) {
    return { label: "No budget", fg: colors.mutedForeground, bg: colors.muted };
  }
  if (spent > planned) {
    return { label: "Over Budget", fg: colors.destructive, bg: colors.destructive };
  }
  const ytdUtil = plannedYtd > 0 ? spent / plannedYtd : 0;
  if (ytdUtil > 1.0) {
    return { label: "Over Pace", fg: colors.destructive, bg: colors.destructive };
  }
  if (ytdUtil > 0.9) {
    return { label: "Monitor", fg: colors.warning, bg: colors.warning };
  }
  return { label: "Under Budget", fg: colors.success, bg: colors.success };
}

export function TimelineExpenditureChart({
  categories,
  currentMonth,
  width,
  title = "Annual Expenditure Timeline",
  subtitle = "Spent to date vs. total expected \u00b7 tap a row to expand",
  interactive = false,
  expandedCategory = null,
  onCategoryPress,
}: TimelineExpenditureChartProps) {
  const colors = useColors();

  const chevronWidth = interactive ? 18 : 0;
  const labelWidth = 140 + chevronWidth;
  const rightPadding = 16;
  const statusChipWidth = 86;
  const axisHeight = 26;
  const rowHeight = 48;
  const refBarHeight = 6;
  const mainBarHeight = 16;
  const paddingTop = 8;

  const chartLeft = labelWidth;
  const chartRight = width - rightPadding - statusChipWidth;
  const chartWidth = Math.max(chartRight - chartLeft, 120);
  const monthWidth = chartWidth / 12;
  const monthToX = (m: number) => chartLeft + monthWidth * (m - 1);
  const height = paddingTop + axisHeight + categories.length * rowHeight + 8;

  const currentX = chartLeft + monthWidth * Math.min(Math.max(currentMonth - 0.5, 0), 12);

  const displaySubtitle = interactive ? subtitle : "Spent to date vs. total expected";

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {displaySubtitle ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{displaySubtitle}</Text>
      ) : null}

      <Svg width={width} height={height}>
        <Defs>
          <Pattern id="hatch-success" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <Rect width={6} height={6} fill={colors.success} opacity={0.18} />
            <Line x1={0} y1={0} x2={0} y2={6} stroke={colors.success} strokeWidth={2} opacity={0.55} />
          </Pattern>
          <Pattern id="hatch-warning" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <Rect width={6} height={6} fill={colors.warning} opacity={0.2} />
            <Line x1={0} y1={0} x2={0} y2={6} stroke={colors.warning} strokeWidth={2} opacity={0.6} />
          </Pattern>
          <Pattern id="hatch-destructive" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <Rect width={6} height={6} fill={colors.destructive} opacity={0.18} />
            <Line x1={0} y1={0} x2={0} y2={6} stroke={colors.destructive} strokeWidth={2} opacity={0.55} />
          </Pattern>
        </Defs>

        {/* Month axis */}
        {MONTH_LABELS.map((m, i) => {
          const x = chartLeft + monthWidth * i + monthWidth / 2;
          return (
            <SvgText key={m} x={x} y={paddingTop + 14} fontSize={10} fill={colors.mutedForeground} textAnchor="middle">
              {m}
            </SvgText>
          );
        })}

        {/* Vertical month gridlines */}
        {Array.from({ length: 13 }).map((_, i) => {
          const x = chartLeft + monthWidth * i;
          return (
            <Line key={`grid-${i}`} x1={x} y1={paddingTop + axisHeight - 6} x2={x} y2={height - 4} stroke={colors.border} strokeWidth={0.5} opacity={0.5} />
          );
        })}

        {/* Rows */}
        {categories.map((c, i) => {
          const rowY = paddingTop + axisHeight + i * rowHeight;
          const barY = rowY + 8;
          const isOpen = expandedCategory === c.category;

          const xStart = monthToX(c.plannedStartMonth);
          const xEnd = monthToX(c.plannedEndMonth + 1);
          const totalW = Math.max(xEnd - xStart, 4);

          const refY = barY + mainBarHeight + 4;

          const spanMonths = Math.max(c.plannedEndMonth - c.plannedStartMonth + 1, 1);
          const elapsedMonths = Math.max(0, Math.min(currentMonth, c.plannedEndMonth) - c.plannedStartMonth + 1);
          const plannedYtd = c.planned * (elapsedMonths / spanMonths);
          const status = statusFor(plannedYtd, c.spent, c.planned, colors);

          const spentRatio = c.planned > 0 ? Math.min(c.spent / c.planned, 1) : 0;
          const solidStart = xStart;
          const solidW = totalW * spentRatio;
          const hatchStart = xStart + solidW;
          const hatchW = Math.max(totalW - solidW, 0);

          const hatchPatternId =
            status.label === "Over Budget" || status.label === "Over Pace"
              ? "url(#hatch-destructive)"
              : status.label === "Monitor"
                ? "url(#hatch-warning)"
                : "url(#hatch-success)";

          const rawLabel = c.category.length > 16 ? c.category.slice(0, 16) + "\u2026" : c.category;

          const rowBg = isOpen ? colors.muted : "transparent";

          return (
            <G
              key={`${c.category}-${i}`}
              onPress={interactive && onCategoryPress ? () => onCategoryPress(c.category) : undefined}
            >
              {/* Hit area + optional highlight */}
              <Rect x={0} y={rowY} width={width} height={rowHeight} fill={rowBg} opacity={isOpen ? 0.6 : 1} />

              {/* Chevron indicator */}
              {interactive && (
                <Path
                  d={isOpen
                    ? `M ${chevronWidth / 2 - 4} ${rowY + rowHeight / 2 - 3} l 8 0 l -4 6 Z`
                    : `M ${chevronWidth / 2 - 3} ${rowY + rowHeight / 2 - 4} l 0 8 l 6 -4 Z`
                  }
                  fill={colors.mutedForeground}
                  opacity={0.7}
                />
              )}

              {/* Category label */}
              <SvgText
                x={labelWidth - 10}
                y={barY + mainBarHeight / 2 + 4}
                fontSize={11}
                fontWeight="600"
                fill={isOpen ? colors.primary : colors.foreground}
                textAnchor="end"
              >
                {rawLabel}
              </SvgText>

              {/* Reference grey bar */}
              <Rect x={xStart} y={refY} width={totalW} height={refBarHeight} fill={colors.border} opacity={0.8} rx={2} />

              {/* Solid spent-to-date bar */}
              {solidW > 0 && (
                <Rect x={solidStart} y={barY} width={solidW} height={mainBarHeight} fill={status.bg} rx={3} />
              )}

              {/* Spent label */}
              {solidW > 36 && c.spent > 0 && (
                <SvgText x={solidStart + solidW - 6} y={barY + mainBarHeight / 2 + 4} fontSize={10} fontWeight="700" fill={colors.primaryForeground} textAnchor="end">
                  {formatShortCurrency(c.spent)}
                </SvgText>
              )}

              {/* Hatched forecast bar */}
              {hatchW > 0 && (
                <Rect x={hatchStart} y={barY} width={hatchW} height={mainBarHeight} fill={hatchPatternId} rx={3} />
              )}

              {/* Total at end of span */}
              {hatchW > 20 && (
                <SvgText
                  x={Math.min(xEnd - 4, width - rightPadding - statusChipWidth - 4)}
                  y={barY + mainBarHeight / 2 + 4}
                  fontSize={10}
                  fontWeight="600"
                  fill={status.fg}
                  textAnchor="end"
                >
                  {formatShortCurrency(c.planned)}
                </SvgText>
              )}

              {/* Status chip */}
              <Rect x={width - rightPadding - statusChipWidth} y={barY - 2} width={statusChipWidth - 4} height={mainBarHeight + 4} fill={status.bg} opacity={0.15} rx={6} />
              <Rect x={width - rightPadding - statusChipWidth} y={barY - 2} width={3} height={mainBarHeight + 4} fill={status.bg} rx={1.5} />
              <SvgText x={width - rightPadding - statusChipWidth + 10} y={barY + mainBarHeight / 2 + 4} fontSize={10} fontWeight="700" fill={status.fg}>
                {status.label}
              </SvgText>
            </G>
          );
        })}

        {/* Current date marker */}
        <Line x1={currentX} y1={paddingTop + axisHeight - 6} x2={currentX} y2={height - 4} stroke={colors.primary} strokeWidth={2} strokeDasharray="4,3" />
        <Rect x={currentX - 18} y={paddingTop} width={36} height={14} fill={colors.primary} rx={3} />
        <SvgText x={currentX} y={paddingTop + 10} fontSize={9} fontWeight="700" fill={colors.primaryForeground} textAnchor="middle">
          TODAY
        </SvgText>
      </Svg>

      {/* Legend */}
      <View style={styles.legend}>
        <LegendDot color={colors.success} label="Under budget" />
        <LegendDot color={colors.warning} label="Monitor" />
        <LegendDot color={colors.destructive} label="Over budget" />
        <LegendDot color={colors.border} label="Total planned" solid />
        <LegendDot color={colors.primary} label="Today" bar />
      </View>
    </View>
  );
}

function LegendDot({ color, label, solid, bar }: { color: string; label: string; solid?: boolean; bar?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.legendItem}>
      {bar ? (
        <View style={{ width: 10, height: 12, backgroundColor: color, borderRadius: 1 }} />
      ) : solid ? (
        <View style={{ width: 14, height: 8, backgroundColor: color, borderRadius: 2 }} />
      ) : (
        <View style={styles.legendSplit}>
          <View style={{ flex: 1, backgroundColor: color, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 }} />
          <View style={{ flex: 1, backgroundColor: color, opacity: 0.3, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
        </View>
      )}
      <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8, paddingHorizontal: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSplit: { width: 22, height: 8, flexDirection: "row", overflow: "hidden", borderRadius: 2 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
