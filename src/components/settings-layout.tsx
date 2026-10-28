import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";

// Building blocks shared by the service settings pages (nginx, PHP): titled
// groups of setting rows, a sticky save bar, and a view of the generated file.

const messages = defineMessages({
  en: {
    allSaved: "All changes saved.",
    resetDefaults: "Reset to defaults",
    openFolder: "Open folder",
  },
  id: {
    allSaved: "Semua perubahan tersimpan.",
    resetDefaults: "Kembalikan ke bawaan",
    openFolder: "Buka folder",
  },
});

/** "← Services" above a settings page. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground" onClick={onClick}>
      <Icon name="arrow-left" className="w-3" />
      {label}
    </Button>
  );
}

export function SettingRow({
  icon,
  title,
  description,
  children,
  below,
  tone,
  className,
}: {
  icon: string;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  /** Shown under the row, e.g. a live port check. */
  below?: ReactNode;
  /** "warning" marks a row that needs attention: tinted, with an amber edge. */
  tone?: "warning";
  className?: string;
}) {
  return (
    <Item
      size="sm"
      // Rows meet their separators edge to edge; the group's card rounds the ends.
      className={cn(
        "flex-wrap rounded-none px-4 py-3",
        tone === "warning" && "border-l-2 border-l-warning bg-warning/[0.07] pl-[14px]",
        className
      )}
    >
      <ItemMedia variant="icon" className={cn(tone === "warning" && "text-warning")}>
        <Icon name={icon} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>{children}</ItemActions>
      {below && <div className="basis-full pl-11">{below}</div>}
    </Item>
  );
}

export function SettingGroup({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode[];
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <ItemGroup>
          {children.map((c, i) => (
            <div key={i}>
              {i > 0 && <ItemSeparator className="my-0" />}
              {c}
            </div>
          ))}
        </ItemGroup>
      </Card>
    </section>
  );
}

/** A whole-number field kept as text, so it can be empty while typing. */
export function NumberInput({
  value,
  onChange,
  label,
  unit,
  disabled,
  allowNegative,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  unit?: string;
  disabled?: boolean;
  allowNegative?: boolean;
}) {
  return (
    <InputGroup className="w-28">
      <InputGroupInput
        inputMode="numeric"
        value={value}
        aria-label={label}
        aria-invalid={!isWhole(value, allowNegative)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit && (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

export function isWhole(v: string, allowNegative = false) {
  return (allowNegative ? /^-?\d+$/ : /^\d+$/).test(v.trim());
}

/** Sticky bar at the bottom of a settings page. */
export function SaveBar({
  dirty,
  saving,
  isDefault,
  note,
  onReset,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  isDefault: boolean;
  /** What saving will do, shown while there are unsaved changes. */
  note: string;
  onReset: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  return (
    <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
      <span className="text-xs text-muted-foreground">{dirty ? note : t.allSaved}</span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" disabled={saving || isDefault} onClick={onReset}>
          {t.resetDefaults}
        </Button>
        <Button size="sm" variant="outline" disabled={saving || !dirty} onClick={onDiscard}>
          {c.discardChanges}
        </Button>
        <Button size="sm" disabled={saving || !dirty} onClick={onSave}>
          {saving && <Spinner />}
          {c.saveChanges}
        </Button>
      </div>
    </div>
  );
}

/** Collapsible read-only view of a generated config file. */
export function GeneratedFile({
  title,
  path,
  text,
  note,
  onOpen,
  onReveal,
}: {
  title: string;
  path: string | null;
  /** null until loaded. */
  text: string | null;
  note: ReactNode;
  /** Called when the section is expanded, to load `text`. */
  onOpen: () => void;
  onReveal: () => Promise<void>;
}) {
  const t = useT(messages);
  const c = useT(common);
  return (
    <Accordion
      type="single"
      collapsible
      className="rounded-xl border px-4"
      onValueChange={(v) => v && onOpen()}
    >
      <AccordionItem value="file" className="border-none">
        <AccordionTrigger className="text-sm">
          <span className="flex items-center gap-2">
            <Icon name="file-code" variant="regular" className="text-muted-foreground" />
            {title}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={path ?? undefined}>
              {path}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReveal().catch((e) => toast.error(String(e)))}
            >
              <Icon name="folder-open" variant="regular" />
              {t.openFolder}
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">
            {text ?? c.loading}
          </pre>
          <p className="text-xs text-muted-foreground">{note}</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
