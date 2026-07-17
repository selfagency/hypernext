export interface SyndicationTarget {
  accessToken: string;
  enabled: boolean;
  instance: string;
  platform: string;
}

export interface SyndicationState {
  docId: number;
  error?: string;
  platform: string;
  platformPostId?: string;
  publishedAt?: string;
  url?: string;
}
