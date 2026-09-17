export interface OpenWebUIChatMessage {
  role: string;
  content: string;
}

export interface OpenWebUIChatRequest extends Record<string, unknown> {
  model: string;
  messages: OpenWebUIChatMessage[];
  stream: false;
}

export interface OpenWebUIChatResponse {
  choices?: Array<{
    message?: { role?: string; content?: unknown };
    text?: unknown;
    finish_reason?: unknown;
  }>;
  [key: string]: unknown;
}

export interface OpenWebUIModel {
  id: string;
  name: string;
}

export interface OpenWebUIModelsResponse {
  data?: unknown[];
  models?: unknown[];
  [key: string]: unknown;
}
