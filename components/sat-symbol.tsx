import { cn } from "@/lib/utils"

export interface SatSymbolProps {
  className?: string
  color?: string
  title?: string
}

export function SatSymbol({ className, color = "currentColor", title }: SatSymbolProps) {
  return (
    <svg
      viewBox="0 0 558.41 760.67"
      className={cn("inline-block h-[1em] w-auto", className)}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="71.89" y="196.83" width="485.35" height="67.21" transform="translate(62.07 -66.72) rotate(13.42)" fill={color} />
      <rect x="35.68" y="348.58" width="485.35" height="67.21" transform="translate(96.31 -54.17) rotate(13.42)" fill={color} />
      <rect x="295.4" y="31.26" width="117.34" height="67.21" transform="translate(499.35 -264.48) rotate(103.42)" fill={color} />
      <rect x="1.17" y="493.2" width="485.35" height="67.21" transform="translate(128.93 -42.21) rotate(13.42)" fill={color} />
      <rect x="144.85" y="662.2" width="117.34" height="67.21" transform="translate(927.56 659.33) rotate(103.42)" fill={color} />
    </svg>
  )
}
