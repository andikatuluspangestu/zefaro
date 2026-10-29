// Build-time entry: renders one page to HTML for scripts/prerender.mjs.
import { renderToString } from "react-dom/server";
import App from "./App";

export { routes, headFor, sitemap, llmsFull } from "./seo";

export function render(path: string): string {
  return renderToString(<App path={path} />);
}
