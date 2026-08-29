/** 消息内容的富格式片段（用于图片输入） */
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export type MessageRole = 'user' | 'assistant';

export interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  images?: string[]; // data URL 或远程 URL
  error?: boolean;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface OpenAIChunkDelta {
  content?: string;
  reasoning_content?: string;
}

export interface OpenAIChunk {
  choices?: { delta?: OpenAIChunkDelta; finish_reason?: string | null }[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
