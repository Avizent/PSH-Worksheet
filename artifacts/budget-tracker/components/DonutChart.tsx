import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/contexts/CurrencyContext";

interface DonutChartProps {
  data: Array<{ category: string; value: number }>;
  size: number;
}

const COLORS = ["#1e6b4e", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function DonutChart({ data, size }: DonutChartProps) {
  const { format } = useCurrency();
  const colors = useColors();
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 8;
  const innerR = outerR * 0.55;
  const strokeWidth = outerR - innerR;
  const midR = (outerR + innerR) / 2;

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  let currentAngle = 0;
  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    return {
      ...d,
      color: COLORS[i % COLORS.length],
      startAngle,
      endAngle,
      pct: Math.round((d.value / total) * 100),
    };
  });

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Budget by Category</Text>
      <View style={styles.container}>
        <Svg width={size} height={size}>
          {slices.map((s, i) => {
            const clampedEnd = Math.min(s.endAngle, s.startAngle + 359.9);
            const path = describeArc(cx, cy, midR, s.startAngle, clampedEnd);
            return (
              <Path
                key={i}
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeWidth}
                strokeLinecap="butt"
              />
            );
          })}
          <SvgText x={cx} y={cy - 6} fontSize={13} fontWeight="bold" fill={colors.foreground} textAnchor="middle">
            {format(total)}
          </SvgText>
          <SvgText x={cx} y={cy + 12} fontSize={11} fill={colors.mutedForeground} textAnchor="middle">
            Total Plan
          </SvgText>
        </Svg>
        <View style={styles.legendContainer}>
          {slices.map((s, i) => (
            <View key={i} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={[styles.legendLabel, { color: colors.foreground }]} numberOfLines={1}>{s.category}</Text>
              <Text style={[styles.legendPct, { color: colors.mutedForeground }]}>{s.pct}%</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  container: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
  legendContainer: { flex: 1, minWidth: 120, gap: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  legendPct: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
