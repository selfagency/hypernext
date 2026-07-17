export interface DocMeta {
  canonicalUrl?: string;
  createdAt?: string;
  date?: string;
  description?: string;
  gemtextCache?: string;
  gopherCache?: string;
  htmlCache?: string;
  id?: number;
  irJson?: string;
  layout?: string;
  metaJson?: string;
  publishedAt?: string;
  rawMdx?: string;
  rssCache?: string;
  slug: string;
  title: string;
  type?: string;
  updatedAt?: string;
}

export interface Term {
  id?: number;
  name: string;
  slug: string;
  taxonomy: string;
}

export interface TermRelationship {
  docId: number;
  termId: number;
}

export interface SyndicationRecord {
  docId: number;
  id?: number;
  platform: string;
  publishedAt?: string;
  url: string;
}

export interface OAuthToken {
  createdAt?: string;
  expiresAt?: string;
  id?: number;
  provider: string;
  refreshToken?: string;
  token: string;
}
