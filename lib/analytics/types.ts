export const PRODUCT_EVENT_NAMES = [
  "page_view",
  "agent_opened",
  "question_submitted",
  "answer_succeeded",
  "answer_failed",
  "related_article_clicked",
  "signup_completed",
  "login_completed",
  "checkin_completed",
  "asset_tracker_opened",
  "feedback_submitted",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const CLIENT_EVENT_NAMES = [
  "page_view",
  "agent_opened",
  "related_article_clicked",
  "asset_tracker_opened",
  "feedback_submitted",
] as const satisfies readonly ProductEventName[];

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export type ProductEventProperties = {
  page_type?: "home" | "series" | "post" | "tool" | "other";
  page_slug?: string;
  source?: string;
  intent?: string;
  provider?: string;
  status?: string;
  error_code?: string;
  latency_ms?: number;
  retrieval_count?: number;
  related_count?: number;
  helpful?: boolean;
};

export type AnalyticsSummary = {
  total_events: number;
  active_actors: number;
  page_views: number;
  visitors: number;
  today_page_views: number;
  today_visitors: number;
  agent_opens: number;
  questions: number;
  answer_successes: number;
  answer_failures: number;
  related_clicks: number;
  signups: number;
  checkins: number;
  feedback_total: number;
  helpful_feedback: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
};

export type AnalyticsDailyPoint = {
  day: string;
  active_actors: number;
  page_views: number;
  visitors: number;
  questions: number;
  successes: number;
  failures: number;
};

export type AnalyticsTopPage = {
  page: string;
  page_views: number;
  visitors: number;
};

export type AnalyticsDashboard = {
  summary: AnalyticsSummary;
  daily: AnalyticsDailyPoint[];
  top_pages: AnalyticsTopPage[];
  event_counts: Array<{ event_name: ProductEventName | string; count: number }>;
};
