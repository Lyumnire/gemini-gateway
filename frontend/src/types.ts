/** 消息内容的富格式片段（用于图片输入） */
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export type MessageRole = 'user' | 'assistant';

/** 界面模式：普通对话 / 文生图 / 深度研究 */
export type ChatMode = 'chat' | 'image' | 'research';

export interface ResearchSource {
  title?: string;
  url?: string;
  snippet?: string;
  domain?: string;
}

/** 深度研究的实时状态（随 SSE 事件更新） */
export interface ResearchState {
  progress: number;
  message: string;
  sources: ResearchSource[];
  done: boolean;
}

export interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  images?: string[]; // data URL 或远程 URL
  research?: ResearchState; // 深度研究进行中的状态
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
