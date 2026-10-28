import { cn } from "cn"
import { Loader2Icon } from "lucide-react"
import { defineMessages, useT } from "@/i18n"

const messages = defineMessages({
  en: { label: "Loading" },
  id: { label: "Memuat" },
})

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useT(messages)
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={t.label} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
