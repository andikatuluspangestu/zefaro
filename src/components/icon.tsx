import { cn } from "@/lib/utils";

type IconProps = {
  /** Font Awesome icon name without the `fa-` prefix, e.g. "globe". */
  name: string;
  variant?: "solid" | "regular" | "brands";
  className?: string;
};

/** Font Awesome webfont icon, fixed-width so icons line up in menus and buttons. */
export function Icon({ name, variant = "solid", className }: IconProps) {
  return (
    <i
      aria-hidden="true"
      className={cn(`fa-${variant} fa-${name}`, "inline-block w-4 shrink-0 text-center", className)}
    />
  );
}
