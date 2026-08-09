import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getGreeting(t: (ru: string, uz: string) => string): string {
  const hour = new Date().getHours();
  return hour < 12
    ? t("Доброе утро", "Xayrli ertalab")
    : hour < 18
    ? t("Добрый день", "Xayrli kun")
    : t("Добрый вечер", "Xayrli kech");
}
