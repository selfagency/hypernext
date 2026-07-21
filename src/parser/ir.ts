export type IrNodeType =
  | "root"
  | "heading"
  | "paragraph"
  | "text"
  | "link"
  | "image"
  | "list"
  | "listItem"
  | "code"
  | "blockquote"
  | "thematicBreak"
  | "inlineCode"
  | "strong"
  | "emphasis"
  | "delete"
  | "table"
  | "tableRow"
  | "tableCell"
  | "math"
  | "inlineMath"
  | "component"
  | "section"
  | "aside"
  | "footer"
  | "header"
  | "main"
  | "time"
  | "mention"
  | "nav";

export interface IrNode {
  align?: ("left" | "center" | "right")[];
  alt?: string;
  authorName?: string;
  authorPhoto?: string;
  authorUrl?: string;
  children?: IrNode[];
  className?: string;
  componentName?: string;
  componentProps?: Record<string, unknown>;
  content?: string;
  datetime?: string;
  depth?: number;
  id?: string;
  lang?: string;
  meta?: string;
  ordered?: boolean;
  platform?: string;
  publishedAt?: string;
  sourceUrl?: string;
  spread?: boolean;
  start?: number;
  type: IrNodeType;
  url?: string;
  value?: string;
}

export interface ParseResult {
  errors: string[];
  frontmatter: Record<string, unknown>;
  ir: IrNode;
  metadata: Record<string, unknown>;
}
