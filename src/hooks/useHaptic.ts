import { useCallback } from "react";

export type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

/**
 * Haptic feedback utility for mobile devices.
 * Falls back to no-op on desktop or unsupported browsers.
 */
export function useHaptic() {
  const trigger = useCallback((style: HapticStyle = "light") => {
    // Vibration API (Android Chrome, some others)
    if ("vibrate" in navigator) {
      const patterns: Record<HapticStyle, number | number[]> = {
        light:  10,
        medium: 20,
        heavy:  30,
        success: [10, 50, 10],
        warning: [20, 30, 20],
        error:   [30, 20, 30, 20, 30],
      };
      navigator.vibrate(patterns[style]);
    }

    // iOS Safari — use AudioContext for subtle feedback
    if (!("vibrate" in navigator) && "AudioContext" in window) {
      try {
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        gainNode.gain.value = 0.01; // Very quiet
        oscillator.frequency.value = style === "error" ? 200 : style === "success" ? 800 : 400;
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.05);
      } catch { /* AudioContext not available */ }
    }
  }, []);

  return { trigger };
}

/**
 * Inline haptic trigger for event handlers.
 * Call `haptic()` on click/tap events.
 */
export const haptic = (style: HapticStyle = "light") => {
  if ("vibrate" in navigator) {
    const patterns: Record<HapticStyle, number | number[]> = {
      light:  10,
      medium: 20,
      heavy:  30,
      success: [10, 50, 10],
      warning: [20, 30, 20],
      error:   [30, 20, 30, 20, 30],
    };
    navigator.vibrate(patterns[style]);
  }
};
