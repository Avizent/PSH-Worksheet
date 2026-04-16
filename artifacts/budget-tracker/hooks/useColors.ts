import colors from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Returns the design tokens for the active color scheme.
 *
 * The scheme is determined by `ThemeContext` — which honors the user's
 * stored preference (light / dark / system) and falls back to the device
 * appearance setting when no preference is set.
 */
export function useColors() {
  const { resolvedScheme } = useTheme();
  const palette = resolvedScheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
