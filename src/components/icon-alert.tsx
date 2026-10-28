import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * shadcn's Alert lays out its icon column with `has-[>svg]` selectors; Font
 * Awesome icons are `<i>` elements, so apply the same two-column grid here.
 */
export function IconAlert({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Alert className={cn("grid-cols-[auto_1fr] gap-x-2.5", className)}>
      <Icon name={icon} className="row-span-2 translate-y-0.5" />
      <AlertTitle className="col-start-2">{title}</AlertTitle>
      {children && <AlertDescription className="col-start-2">{children}</AlertDescription>}
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
