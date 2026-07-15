import { useState } from "react";
import { ChevronDown } from "lucide-react";

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            "border rounded-2xl bg-white overflow-hidden transition-all duration-500",
            open === i ? "border-violet-200 shadow-lg shadow-violet-500/5" : "border-gray-200/50 hover:border-gray-300/60 hover:shadow-md"
          )}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between p-6 text-left group"
          >
            <span className="font-semibold text-[15px] text-gray-900 pr-4 group-hover:text-violet-600 transition-colors">
              {item.q}
            </span>
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
              open === i ? "bg-violet-50 rotate-180" : "bg-gray-50 group-hover:bg-violet-50"
            )}>
              <ChevronDown size={16} className={cn("transition-colors", open === i ? "text-violet-500" : "text-gray-400")} />
            </div>
          </button>
          <div
            className={cn(
              "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
              open === i ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
            )}
          >
            <div className="px-6 pb-6 pt-0">
              <p className="text-sm text-gray-500 leading-relaxed">{item.a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
