export interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface GeminiGenerateRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: Record<string, unknown>;
  tools?: unknown[];
}

export interface GeminiGenerateResponse {
  candidates?: unknown[];
  promptFeedback?: unknown;
  usageMetadata?: unknown;
  [key: string]: unknown;
}
