import { PremiumSelect } from "@/components/PremiumSelect";

export interface CategorySelectorProps {
  value: string | undefined;
  onChange: (category: string | undefined) => void;
  categories: string[];
  lang: string;
  width?: string;
}

export function CategorySelector({ value, onChange, categories, lang, width = "200px" }: CategorySelectorProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  if (!categories.length) return null;

  return (
    <PremiumSelect
      value={value ?? ""}
      onChange={v => onChange(v || undefined)}
      options={[
        { value: "", label: t("Все категории", "Barcha kategoriyalar") },
        ...categories.map(c => ({ value: String(c), label: String(c) })),
      ]}
      width={width}
    />
  );
}
