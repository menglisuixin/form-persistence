import type { Reactive, Ref } from "vue";

// 数据格式转换中间件类型
export interface DataTransformMiddleware {
  // 在保存前转换数据
  beforeSave?: (data: any) => any;
  // 在恢复后转换数据
  afterRestore?: (data: any) => any;
}

// 字段级数据格式转换配置
export interface FieldTransformConfig {
  [fieldName: string]: DataTransformMiddleware;
}

// 文件存储数据结构
export interface StoredFile {
  fileId: number;
  formId: string;
  fieldName: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  lastModified: number;
  data: ArrayBuffer;
  savedTime: string;
}

// 上传进度信息
export interface UploadProgress {
  fieldName: string;
  total: number;
  loaded: number;
  percent: number;
}

// 表单持久化Hook返回类型
export interface UseFormPersistenceReturn<T> {
  formData: Reactive<T>;
  fileData: Reactive<Record<string, StoredFile[]>>;
  hasUnsavedChanges: Ref<boolean>;
  uploadProgress: Ref<UploadProgress | null>;
  error: Ref<string | null>;
  saveFiles: (fieldName: string, files: File[]) => Promise<void>;
  clearStorage: () => Promise<void>;
  restoreData: () => Promise<void>;
  clearError: () => void;
  getFormDataJson: () => string; // 获取表单数据的JSON字符串
  getFileDataJson: () => string; // 获取文件数据的JSON字符串
  // 添加注册中间件的方法
  registerTransformMiddleware: (middleware: DataTransformMiddleware) => void;
  // 添加字段级中间件配置方法
  registerFieldTransforms: (fieldTransforms: FieldTransformConfig) => void;
}
// 错误级别枚举
export type ErrorLevel = 'none' | 'basic' | 'detailed';

// 表单持久化选项接口
export interface UseFormPersistenceOptions {
  fileFields: string[]; // 由组件传入的文件字段列表
  clearOnClose?: boolean; // 是否在页面关闭时清除数据
  dataExpiryMs?: number; // 数据过期时间（毫秒），默认24小时
  errorLevel?: ErrorLevel; // 错误报告级别
  onError?: (error: Error, context: string) => void; // 错误回调函数
  // 全局数据转换中间件
  transformMiddleware?: DataTransformMiddleware;
  // 字段级数据转换配置
  fieldTransforms?: FieldTransformConfig;
}
