import { parseToIR } from "../../parser/pipeline.js";
import { renderMarkdown } from "../../renderers/markdown.js";

export async function processPdfGeneration(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const slug = payload.slug as string;
  const rawMdx = payload.rawMdx as string;

  const result = parseToIR(rawMdx, slug);
  const md = renderMarkdown(result.ir);

  const site = config?.site as Record<string, unknown> | undefined;
  const pdfCfg = (site?.pdf ?? {}) as Record<string, unknown> | undefined;
  const cssPath = pdfCfg?.cssPath
    ? (await import("node:path")).resolve(pdfCfg.cssPath as string)
    : undefined;

  try {
    const { mdToPdf } = await import("md-to-pdf");
    const pdf = await mdToPdf(
      { content: md },
      {
        css: cssPath
          ? (await import("node:fs")).readFileSync(cssPath, "utf-8")
          : undefined,
      }
    );
    if (pdf) {
      const { writeStorage } = await import("../../storage/index.js");
      await writeStorage(`${slug}.pdf`, pdf.content.toString());
    }
  } catch (error) {
    console.error(`PDF generation failed for ${slug}:`, error);
  }
}
