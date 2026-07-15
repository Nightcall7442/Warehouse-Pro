import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  return hour < 12
    ? t("agent.goodMorning")
    : hour < 18
    ? t("agent.goodAfternoon")
    : t("agent.goodEvening");
}
