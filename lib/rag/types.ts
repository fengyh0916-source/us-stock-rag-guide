export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ClarificationState = {
  original_question: string;
  topic: string;
  asked_count: number;
  pending_slot: string;
  collected: Record<string, string>;
};

export type ChatRequest = {
  message: string;
  pageContext?: {
    type: "home" | "series" | "post";
    slug?: string;
  };
  history?: ChatHistoryMessage[];
  clarificationState?: ClarificationState | null;
};

export type ChatSource = {
  title: string;
  section: string;
  url?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
};

export type ChatResponse = {
  answer: string;
  warnings: string[];
  sources: ChatSource[];
  relatedArticles: {
    title: string;
    url: string;
  }[];
  intent?: string;
  contextsUsed?: number;
  provider?: "agent" | "mock";
  clarificationState?: ClarificationState | null;
};
