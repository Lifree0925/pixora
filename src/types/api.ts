export type GenerationMode = "text_to_image" | "image_edit" | "multi_image_edit";
export type ImageSize = string;
export type TaskStatus =
  "pending" | "submitting" | "processing" | "timed_out" | "submit_unknown" | "succeeded" | "failed";

export interface AssetView {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  previewUrl: string;
}

export interface ModelParameterDefinition {
  key: string;
  label: string;
  type: "enum" | "number" | "boolean" | "string";
  group?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

export interface TaskView {
  id: string;
  conversationId: string;
  mode: GenerationMode;
  prompt: string;
  requestedSize: string;
  model: string;
  modelName: string;
  parameters: Record<string, string | number | boolean>;
  status: TaskStatus;
  canResume: boolean;
  inputs: AssetView[];
  outputs: AssetView[];
  actualWidth: number | null;
  actualHeight: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerRawStatus: string | null;
  nextPollAt: string | null;
  parentTaskId: string | null;
  parentAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  verified: boolean;
  capabilities: {
    textToImage: boolean;
    imageEdit: boolean;
    multiImageEdit: boolean;
  };
  limits: {
    maxReferenceImages: number;
    maxUploadMb: number;
    maxTotalUploadMb: number;
    maxImagePixels: number;
    promptMaxChars: number;
    supportedMimeTypes: string[];
  };
  sizes: Array<{ label: string; value: ImageSize }>;
  parameters: ModelParameterDefinition[];
}

export interface HistoryConversationItem {
  id: string;
  title: string;
  latestPromptSummary: string;
  model: string;
  modelName: string;
  status: TaskStatus;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  latestTaskId: string;
  thumbnailUrl: string | null;
  outputAssetId: string | null;
  errorCode: string | null;
}

export interface ConversationView {
  id: string;
  title: string;
  model: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  latestTaskId: string;
  latestSuccessfulTaskId: string | null;
  turns: TaskView[];
}

/** @deprecated 使用 HistoryConversationItem；保留别名避免旧调用方编译中断。 */
export type HistoryItem = HistoryConversationItem;
