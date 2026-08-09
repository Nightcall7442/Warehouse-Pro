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
      background: "var(--color-primary)",
      color: "var(--color-on-primary)",
    },
    secondary: {
      background: "var(--color-surface-light, #f6f4f0)",
      color: "var(--color-text-secondary, #5e5b54)",
    },
    destructive: {
      background: "var(--kpi-red-track)",
      color: "var(--color-danger-text)",
    },
    outline: {
      background: "transparent",
      color: "var(--color-text-primary, #2b2a28)",
      border: "1px solid var(--color-border, #d8d5cd)",
    },
    success: {
      background: "var(--kpi-green-track)",
      color: "var(--color-success-text)",
    },
    warning: {
      background: "var(--kpi-amber-track)",
      color: "var(--color-warning-text)",
    },
    info: {
      background: "var(--kpi-blue-track)",
      color: "var(--color-info, #5a8fad)",
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
