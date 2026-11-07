/** A request to open Zefaro's Terminal for a site, from another page. */
export interface TerminalRequest {
  /** Every request is new, even for the same site and command. */
  id: number;
  site: string;
  /** Typed into the new terminal and run, e.g. `php artisan migrate`. */
  command?: string;
}

const EVENT = "zefaro:terminal";
let next = 0;

/** Open a terminal in the site's folder with its PHP; App switches to the Terminal page. */
export function openInTerminal(site: string, command?: string) {
  window.dispatchEvent(new CustomEvent<TerminalRequest>(EVENT, { detail: { id: ++next, site, command } }));
}

export function onTerminalRequest(handler: (r: TerminalRequest) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<TerminalRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
