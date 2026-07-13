import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-[8px] px-2.5 py-1 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-none text-white",
        secondary:
          "border-none text-secondary-foreground",
        destructive:
          "border-none text-white",
        outline:
          "border-none text-foreground",
        success:
          "border-none",
        warning:
          "border-none",
        info:
          "border-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  // Apply pastel background + text color based on variant
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: "var(--color-primary, #4b6cf6)",
      color: "#fff",
    },
    secondary: {
      background: "var(--color-surface-light, #f0f3f8)",
      color: "var(--color-text-secondary, #6a7290)",
    },
    destructive: {
      background: "var(--kpi-red-track, #fce0e0)",
      color: "var(--color-danger, #e85050)",
    },
    outline: {
      background: "transparent",
      color: "var(--color-text-primary, #2b3450)",
      border: "1px solid var(--color-border, #dde2ec)",
    },
    success: {
      background: "var(--kpi-green-track, #d9f2e1)",
      color: "var(--color-success, #34c473)",
    },
    warning: {
      background: "var(--kpi-amber-track, #fdf0d5)",
      color: "var(--color-warning, #e8a830)",
    },
    info: {
      background: "var(--kpi-blue-track, #dce8fc)",
      color: "var(--color-info, #60a5fa)",
    },
  }

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      style={variantStyles[variant ?? "default"] ?? variantStyles.default}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants }
