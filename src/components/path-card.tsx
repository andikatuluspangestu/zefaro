import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    added: (commands: string) => `Added to PATH. Open a new terminal to use ${commands}.`,
    addFailed: (e: unknown) => `Couldn't update PATH: ${e}`,
    title: "Command line (PATH)",
    onPathText: (commands: string) => `${commands} work in any terminal you open from now on.`,
    offPathText: (commands: string) => `Add Zefaro's folder to your user PATH to use ${commands} in any terminal.`,
    onPath: "On PATH",
    addToPath: "Add to PATH",
  },
  id: {
    added: (commands: string) => `Ditambahkan ke PATH. Buka terminal baru untuk memakai ${commands}.`,
    addFailed: (e: unknown) => `Gagal memperbarui PATH: ${e}`,
    title: "Command line (PATH)",
    onPathText: (commands: string) => `${commands} bisa dipakai di terminal mana pun yang Anda buka mulai sekarang.`,
    offPathText: (commands: string) => `Tambahkan folder Zefaro ke PATH pengguna agar ${commands} bisa dipakai di terminal mana pun.`,
    onPath: "Ada di PATH",
    addToPath: "Tambahkan ke PATH",
  },
});

/** Whether Zefaro's bin folder (php, composer, laravel, node, npm, npx shims) is
 *  on the user PATH, with "Add to PATH" when it isn't. */
export function PathCard({
  binDir,
  onPath,
  commands,
  onChanged,
}: {
  binDir: string;
  onPath: boolean;
  /** e.g. "php, composer and laravel", already in the interface language. */
  commands: string;
  onChanged: () => void;
}) {
  const t = useT(messages);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    try {
      await api.addBinToPath();
      toast.success(t.added(commands));
    } catch (e) {
      toast.error(t.addFailed(e));
    }
    setAdding(false);
    onChanged();
  };

  return (
    <ItemGroup className="gap-0 rounded-xl border bg-card">
      <Item className="px-4 py-3">
        <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
          <Icon name="terminal" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{t.title}</ItemTitle>
          <ItemDescription>
            {onPath ? t.onPathText(commands) : t.offPathText(commands)}
          </ItemDescription>
          <code
            className="mt-1 block truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
            title={binDir}
          >
            {binDir}
          </code>
        </ItemContent>
        <ItemActions>
          {onPath ? (
            <Badge variant="outline" className="gap-1.5">
              <Icon name="circle-check" className="w-3 text-success" />
              {t.onPath}
            </Badge>
          ) : (
            <Button size="sm" variant="secondary" disabled={adding} onClick={add}>
              {adding && <Spinner />}
              {t.addToPath}
            </Button>
          )}
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
