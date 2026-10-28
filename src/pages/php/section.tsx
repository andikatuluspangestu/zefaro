import type { ReactNode } from "react";

/** Titled block in the PHP versions list ("Versions", "Command-line tools"). */
export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** Rendered next to the title, e.g. a version badge. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Compare PHP lines numerically: "8.10" > "8.9". */
export function cmpMinor(a: string, b: string): number {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}
