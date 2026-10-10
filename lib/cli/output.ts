export function formatText(value: unknown, indent = ""): string {
  if (Array.isArray(value)) return value.length ? value.map((item) => formatText(item, indent)).join("\n\n") : `${indent}(none)`
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => {
    const label = key.replace(/([a-z])([A-Z])/g, "$1 $2")
    if (item && typeof item === "object") return `${indent}${label}:\n${formatText(item, `${indent}  `)}`
    return `${indent}${label}: ${item === null || item === undefined ? "-" : String(item)}`
  }).join("\n")
  return `${indent}${String(value)}`
}
