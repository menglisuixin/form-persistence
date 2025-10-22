import type {
  StoredFile,
  UseFormPersistenceReturn,
  UseFormPersistenceOptions,
  UploadProgress,
  ErrorLevel,
  DataTransformMiddleware,
  FieldTransformConfig,
} from "../types/useFormPersistenceType";
import {
  ref,
  reactive,
  watch,
  onMounted,
  onUnmounted,
  type Reactive,
} from "vue";

// 默认配置常量
const DEFAULT_DATA_EXPIRY_MS = 24 * 60 * 60 * 1000; // 默认24小时过期
const DEFAULT_ERROR_LEVEL: ErrorLevel = "basic"; // 默认基本错误级别

// 存储常量
const STORAGE_PREFIX = "form_persistence_";
const DB_NAME = "FormPersistenceDB";
const DB_VERSION = 1;
const DB_STORE_NAME = "form_files";

// 错误处理函数
const handleError = (
  error: Error,
  context: string,
  errorLevel: ErrorLevel,
  onError?: (error: Error, context: string) => void
): string => {
  const errorMessage = `${context}: ${error.message}`;

  // 根据错误级别处理
  if (errorLevel === "detailed") {
    console.error(errorMessage, error);
  } else if (errorLevel === "basic") {
    console.warn(errorMessage);
  }

  // 调用用户提供的错误回调
  if (onError) {
    onError(error, context);
  }

  return errorMessage;
};

// IndexedDB工具类（带类型约束）
class FileStorage {
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) {
      return; // 避免重复初始化
    }

    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
          try {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
              db.createObjectStore(DB_STORE_NAME, {
                keyPath: "fileId",
                autoIncrement: true,
              });
            }
          } catch (error) {
            reject(
              new Error(
                `数据库升级失败: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            );
          }
        };

        request.onsuccess = (e: Event) => {
          this.db = (e.target as IDBOpenDBRequest).result;
          this.isInitialized = true;
          resolve();
        };

        request.onerror = (e: Event) => {
          const dbError = (e.target as IDBOpenDBRequest).error;
          reject(
            new Error(`数据库初始化失败: ${dbError?.message || "未知错误"}`)
          );
        };
      } catch (error) {
        reject(
          new Error(
            `IndexedDB操作失败: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }
    });
  }

  async saveFile(
    file: File,
    formId: string,
    fieldName: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<number> {
    const db = this.db;
    if (!db) {
      throw new Error("数据库未初始化");
    }

    // 1. 读取文件为 ArrayBuffer（包装为 Promise，确保同步完成）
    const fileDataBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (result instanceof ArrayBuffer) {
          if (onProgress) {
            onProgress(file.size, file.size); // 读取完成时，进度为100%
          }
          resolve(result);
        } else {
          reject(new Error("文件读取结果不是 ArrayBuffer"));
        }
      };
      reader.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

    // 2. 读取完成后，再开启事务执行 add 操作（确保事务在同步代码中）
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE_NAME, "readwrite", {
        durability: "relaxed",
      });
      const store = transaction.objectStore(DB_STORE_NAME);

      // 事务错误处理
      transaction.onerror = () => {
        reject(new Error(`事务错误: ${transaction.error?.message}`));
      };

      // 构建文件数据
      const fileData: Omit<StoredFile, "fileId"> = {
        formId,
        fieldName,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        lastModified: file.lastModified,
        data: fileDataBuffer, // 使用已读取的 buffer
        savedTime: new Date().toISOString(),
      };

      // 执行添加操作
      const addRequest = store.add(fileData as StoredFile);
      addRequest.onsuccess = () => {
        transaction.oncomplete = () => {
          resolve(addRequest.result as number);
        };
      };
      addRequest.onerror = () => {
        reject(new Error(`添加文件失败: ${addRequest.error?.message}`));
      };
    });
  }

  async getFiles(formId: string, fieldName: string): Promise<StoredFile[]> {
    if (!this.db) throw new Error("数据库未初始化");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(DB_STORE_NAME, "readonly");
      const store = transaction.objectStore(DB_STORE_NAME);
      const files: StoredFile[] = [];
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (e: Event) => {
        const cursor = (
          e.target as unknown as IDBRequest<IDBCursorWithValue | null>
        ).result;
        if (cursor) {
          const file = cursor.value as StoredFile;
          if (file.formId === formId && file.fieldName === fieldName) {
            files.push(file);
          }
          cursor.continue();
        } else {
          resolve(files);
        }
      };

      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }

  async clearFiles(formId: string): Promise<void> {
    if (!this.db) throw new Error("数据库未初始化");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(DB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(DB_STORE_NAME);
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (e: Event) => {
        const cursor = (e.target as unknown as IDBRequest<IDBCursorWithValue>)
          .result;
        if (cursor) {
          const file = cursor.value as StoredFile;
          if (file.formId === formId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }
  getTransaction(mode: "readonly" | "readwrite"): IDBTransaction {
    if (!this.db) throw new Error("数据库未初始化");
    return this.db.transaction(DB_STORE_NAME, mode);
  }
}

// 全局文件存储实例
const fileStorage = new FileStorage();

// 主Hook（泛型支持任意表单结构）
export function useFormPersistence<T extends object>(
  formId: string,
  initialFormData: T,
  options: UseFormPersistenceOptions
): UseFormPersistenceReturn<T> {
  // 合并默认选项
  const {
    fileFields,
    clearOnClose = false,
    dataExpiryMs = DEFAULT_DATA_EXPIRY_MS,
    errorLevel = DEFAULT_ERROR_LEVEL,
    onError,
    transformMiddleware = {},
    fieldTransforms = {},
  } = options;

  // 存储中间件的响应式引用
  const currentMiddleware = ref<DataTransformMiddleware>({
    ...transformMiddleware,
  });
  // 存储字段级转换配置的响应式引用
  const currentFieldTransforms = reactive<FieldTransformConfig>({
    ...fieldTransforms,
  });

  // 应用保存前的数据转换
  const applyBeforeSaveTransform = (data: any): any => {
    let transformedData = { ...data };

    // 先应用字段级别的转换
    Object.keys(transformedData).forEach((field) => {
      const fieldMiddleware = currentFieldTransforms[field];
      if (fieldMiddleware && fieldMiddleware.beforeSave) {
        try {
          transformedData[field] = fieldMiddleware.beforeSave(
            transformedData[field]
          );
        } catch (error) {
          handleError(
            error instanceof Error ? error : new Error(String(error)),
            `字段[${field}]保存前转换失败`,
            errorLevel,
            onError
          );
        }
      }
    });

    // 再应用全局中间件的转换
    if (currentMiddleware.value.beforeSave) {
      try {
        transformedData = currentMiddleware.value.beforeSave(transformedData);
      } catch (error) {
        handleError(
          error instanceof Error ? error : new Error(String(error)),
          "全局保存前转换失败",
          errorLevel,
          onError
        );
      }
    }

    return transformedData;
  };

  // 应用恢复后的数据转换
  const applyAfterRestoreTransform = (data: any): any => {
    let transformedData = { ...data };

    // 先应用全局中间件的转换
    if (currentMiddleware.value.afterRestore) {
      try {
        transformedData = currentMiddleware.value.afterRestore(transformedData);
      } catch (error) {
        handleError(
          error instanceof Error ? error : new Error(String(error)),
          "全局恢复后转换失败",
          errorLevel,
          onError
        );
      }
    }

    // 再应用字段级别的转换
    Object.keys(transformedData).forEach((field) => {
      const fieldMiddleware = currentFieldTransforms[field];
      if (fieldMiddleware && fieldMiddleware.afterRestore) {
        try {
          transformedData[field] = fieldMiddleware.afterRestore(
            transformedData[field]
          );
        } catch (error) {
          handleError(
            error instanceof Error ? error : new Error(String(error)),
            `字段[${field}]恢复后转换失败`,
            errorLevel,
            onError
          );
        }
      }
    });

    return transformedData;
  };

  // 注册全局转换中间件
  const registerTransformMiddleware = (
    middleware: DataTransformMiddleware
  ): void => {
    currentMiddleware.value = { ...currentMiddleware.value, ...middleware };
  };

  // 注册字段级转换配置
  const registerFieldTransforms = (
    fieldTransforms: FieldTransformConfig
  ): void => {
    Object.assign(currentFieldTransforms, fieldTransforms);
  };

  // 添加获取表单数据JSON的方法
  const getFormDataJson = (): string => {
    const formDataCopy = { ...formData };
    return JSON.stringify(formDataCopy);
  };

  // 添加获取文件数据JSON的方法
  const getFileDataJson = (): string => {
    const fileDataCopy = { ...fileData };
    // 转换文件数据，只保留需要的信息
    const simplifiedFileData: Record<string, any[]> = {};

    Object.keys(fileDataCopy).forEach((fieldName) => {
      // 确保fileDataCopy[fieldName]是数组，避免undefined.map()错误
      if (Array.isArray(fileDataCopy[fieldName])) {
        simplifiedFileData[fieldName] = fileDataCopy[fieldName].map((file) => ({
          fileName: file.fileName,
          fileSize: file.fileSize,
          fileType: file.fileType,
          lastModified: file.lastModified,
        }));
      } else {
        // 如果不是数组，初始化为空数组
        simplifiedFileData[fieldName] = [];
      }
    });

    return JSON.stringify(simplifiedFileData);
  };
  // 响应式表单数据
  const formData = reactive<T>({ ...initialFormData });
  // 响应式文件数据（键为字段名，值为文件数组）
  const fileData: Reactive<Record<string, StoredFile[]>> = reactive(
    fileFields.reduce((acc, field) => {
      acc[field] = [];
      return acc;
    }, {} as Record<string, StoredFile[]>)
  );
  // 未保存状态标记
  const hasUnsavedChanges = ref<boolean>(false);
  // 上传进度
  const uploadProgress = ref<UploadProgress | null>(null);
  // 错误信息
  const error = ref<string | null>(null);
  // 存储键
  const storageKey = `${STORAGE_PREFIX}${formId}`;
  // sessionStorage键名
  const sessionKey = `${STORAGE_PREFIX}${formId}_session`;

  // 正常关闭标记键名
  const normalCloseKey = `${STORAGE_PREFIX}${formId}_normal_close`;

  // 检查数据是否过期
  const isDataExpired = (savedAt?: string): boolean => {
    if (!savedAt) return false;

    const savedTime = new Date(savedAt).getTime();
    const now = new Date().getTime();

    return now - savedTime > dataExpiryMs;
  };

  // 从sessionStorage恢复数据
  const restoreFromSessionStorage = (): {
    formOnly: Partial<T>;
    success: boolean;
  } => {
    try {
      const savedText = sessionStorage.getItem(sessionKey);
      if (!savedText) {
        return { formOnly: {}, success: false };
      }

      const parsed = JSON.parse(savedText) as Partial<T> & { savedAt?: string };

      // 检查数据是否过期
      if (isDataExpired(parsed.savedAt)) {
        sessionStorage.removeItem(sessionKey);
        return { formOnly: {}, success: false };
      }

      // 移除savedAt字段，只恢复表单数据
      const formDataWithoutTimestamp = { ...parsed };
      delete formDataWithoutTimestamp.savedAt;

      // 应用恢复后的数据转换
      const transformedData = applyAfterRestoreTransform(
        formDataWithoutTimestamp
      );

      return { formOnly: transformedData as Partial<T>, success: true };
    } catch (error) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        "从sessionStorage恢复数据",
        errorLevel,
        onError
      );
      return { formOnly: {}, success: false };
    }
  };

  // 从localStorage恢复数据（崩溃恢复）
  const restoreFromLocalStorage = (): {
    formOnly: Partial<T>;
    success: boolean;
  } => {
    try {
      const localStorageText = localStorage.getItem(storageKey);
      if (!localStorageText) {
        return { formOnly: {}, success: false };
      }

      const parsed = JSON.parse(localStorageText) as Partial<T> & {
        savedAt?: string;
      };

      // 检查数据是否过期
      if (isDataExpired(parsed.savedAt)) {
        localStorage.removeItem(storageKey);
        return { formOnly: {}, success: false };
      }

      // 移除savedAt字段，只恢复表单数据
      const formDataWithoutTimestamp = { ...parsed };
      delete formDataWithoutTimestamp.savedAt;

      // 应用恢复后的数据转换
      const transformedData = applyAfterRestoreTransform(
        formDataWithoutTimestamp
      );

      // 将恢复的数据同步到sessionStorage
      sessionStorage.setItem(sessionKey, localStorageText);

      return { formOnly: transformedData as Partial<T>, success: true };
    } catch (error) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        "从localStorage恢复数据",
        errorLevel,
        onError
      );
      return { formOnly: {}, success: false };
    }
  };

  // 恢复文件数据
  const restoreFileData = async (shouldRestore: boolean): Promise<void> => {
    if (!shouldRestore) return;

    try {
      for (const field of fileFields) {
        fileData[field] = await fileStorage.getFiles(formId, field);
      }
    } catch (error) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        "恢复文件数据",
        errorLevel,
        onError
      );
    }
  };

  // 恢复数据 - 智能恢复机制，支持崩溃恢复
  const restoreData = async (): Promise<void> => {
    try {
      // 检查sessionKey是否存在（判断是刷新还是重新打开）
      const sessionExists = sessionStorage.getItem(sessionKey) !== null;
      // 检查是否有正常关闭标记
      const isNormalClose = localStorage.getItem(normalCloseKey) === "true";
      // 检查localStorage中是否有数据
      const hasLocalStorageData = localStorage.getItem(storageKey) !== null;

      // 崩溃恢复逻辑：
      // 1. 如果session不存在但localStorage有数据，并且没有正常关闭标记，说明是崩溃场景
      // 2. 只有在崩溃场景下才从localStorage恢复数据
      const isCrashRecovery =
        !sessionExists && hasLocalStorageData && !isNormalClose;

      let formOnly: Partial<T> = {};
      let isFromLocalStorage = false;

      // 优先从sessionStorage恢复（适用于页面刷新场景）
      const sessionResult = restoreFromSessionStorage();
      if (sessionResult.success) {
        formOnly = sessionResult.formOnly;
      }
      // 如果sessionStorage恢复失败且是崩溃恢复场景，尝试从localStorage恢复
      else if (isCrashRecovery) {
        const localStorageResult = restoreFromLocalStorage();
        if (localStorageResult.success) {
          formOnly = localStorageResult.formOnly;
          isFromLocalStorage = true;
        }
      }

      // 应用恢复的数据
      if (Object.keys(formOnly).length > 0) {
        Object.assign(formData, formOnly);
      }

      // 恢复文件数据的条件
      const shouldRestoreFiles =
        sessionExists ||
        isFromLocalStorage ||
        (!isNormalClose && localStorage.getItem(storageKey) !== null);

      await restoreFileData(shouldRestoreFiles);

      // 检查是否有实际数据被恢复，更新响应式状态
      const hasData = Object.values(formData).some(
        (val) => val !== null && val !== undefined && val !== ""
      );
      const hasFiles = Object.values(fileData).some(
        (files) => files.length > 0
      );
      hasUnsavedChanges.value = hasData || hasFiles;
      error.value = null;
    } catch (err) {
      const errorMessage = handleError(
        err instanceof Error ? err : new Error(String(err)),
        "恢复数据",
        errorLevel,
        onError
      );
      error.value = errorMessage;
      hasUnsavedChanges.value = false;
    }
  };

  // 清除错误信息
  const clearError = (): void => {
    error.value = null;
  };

  // 保存文本数据 - 同时保存到localStorage和sessionStorage
  const saveTextData = (): void => {
    try {
      // 应用保存前的数据转换
      const transformedFormData = applyBeforeSaveTransform(formData);

      const dataWithTimestamp = {
        ...transformedFormData,
        savedAt: new Date().toISOString(),
      };
      const dataString = JSON.stringify(dataWithTimestamp);

      // 先保存到sessionStorage，再保存到localStorage
      sessionStorage.setItem(sessionKey, dataString);
      localStorage.setItem(storageKey, dataString);

      hasUnsavedChanges.value = true;
      error.value = null;
    } catch (err) {
      const errorMessage = handleError(
        err instanceof Error ? err : new Error(String(err)),
        "保存文本数据",
        errorLevel,
        onError
      );
      error.value = errorMessage;
    }
  };

  // 删除指定字段的旧文件
  const deleteOldFiles = async (fieldName: string): Promise<void> => {
    try {
      const oldFiles = await fileStorage.getFiles(formId, fieldName);
      if (oldFiles.length === 0) return;

      const transaction = fileStorage.getTransaction("readwrite");
      const store = transaction.objectStore(DB_STORE_NAME);

      const deletePromises = oldFiles.map(
        (oldFile) =>
          new Promise<void>((resolve, reject) => {
            const request = store.delete(oldFile.fileId);
            request.onsuccess = () => resolve();
            request.onerror = () =>
              reject(new Error(`删除文件失败: ${oldFile.fileId}`));
          })
      );

      await Promise.all(deletePromises);
    } catch (error) {
      throw new Error(
        `删除旧文件失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  // 保存单个文件
  const saveSingleFile = async (
    file: File,
    fieldName: string,
    totalSize: number,
    loadedSize: number
  ): Promise<StoredFile> => {
    const fileId = await fileStorage.saveFile(
      file,
      formId,
      fieldName,
      (loaded) => {
        // 简化的进度计算逻辑
        const currentLoaded = loadedSize + loaded;
        const percent = Math.round((currentLoaded / totalSize) * 100);

        uploadProgress.value = {
          fieldName,
          total: totalSize,
          loaded: currentLoaded,
          percent,
        };
      }
    );

    // 获取已保存的文件信息
    const savedFiles = await fileStorage.getFiles(formId, fieldName);
    const savedFile = savedFiles.find((f) => f.fileId === fileId);

    if (!savedFile) {
      throw new Error(`无法找到刚保存的文件: ${fileId}`);
    }

    return savedFile;
  };

  // 保存文件
  const saveFiles = async (fieldName: string, files: File[]): Promise<void> => {
    try {
      error.value = null;
      uploadProgress.value = null;

      // 参数验证
      if (!fieldName || !files || files.length === 0) {
        throw new Error("无效的文件保存参数");
      }

      // 先删除旧文件
      await deleteOldFiles(fieldName);

      // 保存新文件，添加进度跟踪
      const newFiles: StoredFile[] = [];
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      let loadedSize = 0;

      for (const file of files) {
        const savedFile = await saveSingleFile(
          file,
          fieldName,
          totalSize,
          loadedSize
        );
        newFiles.push(savedFile);
        loadedSize += file.size;
      }

      fileData[fieldName] = newFiles;
      hasUnsavedChanges.value = true;
      uploadProgress.value = null; // 上传完成，清除进度
    } catch (err) {
      const errorMessage = handleError(
        err instanceof Error ? err : new Error(String(err)),
        "保存文件",
        errorLevel,
        onError
      );
      error.value = errorMessage;
      uploadProgress.value = null;
      throw err; // 重新抛出错误以便调用方可以捕获
    }
  };
  // 页面离开处理 - 只负责保存数据，不清除数据
  const handlePageLeave = (): void => {
    if (hasUnsavedChanges.value) {
      saveTextData();
    }
  };

  // beforeunload处理 - 显示确认提示
  const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (hasUnsavedChanges.value && !clearOnClose) {
      e.preventDefault();
      // e.returnValue = "有未保存的数据，是否离开？";
    }
  };

  // 页面关闭时处理
  const handlePageClose = async (): Promise<void> => {
    // 保存数据到sessionStorage和localStorage
    if (hasUnsavedChanges.value) {
      handlePageLeave();
    }

    // 只有在pagehide事件触发时才设置正常关闭标记
    // 因为visibilitychange可能在切换标签页等场景下触发
    if (document.visibilityState === "hidden") {
      // 可以添加额外的检查来判断是否真正要关闭页面
      // 这里使用sessionStorage作为临时存储，因为浏览器崩溃时sessionStorage会被清除
      sessionStorage.setItem(normalCloseKey, "true");
      // 然后复制到localStorage以便下次启动时检查
      setTimeout(() => {
        if (sessionStorage.getItem(normalCloseKey)) {
          localStorage.setItem(normalCloseKey, "true");
        }
      }, 0);
    }
  };

  // 清理存储
  const clearStorage = async (): Promise<void> => {
    try {
      // 清除sessionStorage数据
      sessionStorage.removeItem(sessionKey);

      // 清除localStorage数据
      localStorage.removeItem(storageKey);
      localStorage.removeItem(normalCloseKey);

      // 清除IndexedDB数据
      await fileStorage.clearFiles(formId);

      // 重置状态
      hasUnsavedChanges.value = false;
      error.value = null;

      // 清空文件数据
      for (const field of fileFields) {
        fileData[field] = [];
      }
    } catch (err) {
      const errorMessage = handleError(
        err instanceof Error ? err : new Error(String(err)),
        "清理存储",
        errorLevel,
        onError
      );
      error.value = errorMessage;
    }
  };

  // 监听表单数据变化
  watch(formData, () => saveTextData(), { deep: true });

  // 清理正常关闭数据
  const cleanNormalCloseData = async (): Promise<void> => {
    if (clearOnClose) {
      try {
        // 清除所有存储
        sessionStorage.removeItem(sessionKey);
        localStorage.removeItem(storageKey);
        localStorage.removeItem(normalCloseKey);

        // 清除IndexedDB数据
        await fileStorage.clearFiles(formId);

        // 清空文件数据
        for (const field of fileFields) {
          fileData[field] = [];
        }
      } catch (err) {
        handleError(
          err instanceof Error ? err : new Error(String(err)),
          "清理正常关闭数据",
          errorLevel,
          onError
        );
      }
    }
  };

  // 生命周期
  onMounted(async () => {
    try {
      // 初始化fileStorage
      await fileStorage.init();

      // 检查sessionKey是否存在（判断是刷新还是重新打开）
      const sessionExists = sessionStorage.getItem(sessionKey) !== null;
      // 检查是否有正常关闭标记
      const isNormalClose = localStorage.getItem(normalCloseKey) === "true";

      // 核心清理逻辑：
      // 1. 当clearOnClose=true且检测到正常关闭标记时，必须清空所有数据
      // 2. 无论是否有数据，都需要移除normal_close标记，为下次运行做准备
      if (!sessionExists && isNormalClose && clearOnClose) {
        // 先移除normal_close标记，避免多次触发清理
        localStorage.removeItem(normalCloseKey);
        // 执行清理操作，清空所有存储的数据
        await cleanNormalCloseData();
      }
      // 当检测到正常关闭标记但clearOnClose=false时，只移除标记，保留数据
      else if (!sessionExists && isNormalClose) {
        localStorage.removeItem(normalCloseKey);
      }

      // 恢复数据（包括文件）
      // 注意：由于上面的清理逻辑，正常关闭且clearOnClose=true的情况下，此处不会有数据可恢复
      await restoreData();

      // 在恢复完成后，如果没有session存在（表示不是刷新），确保移除normal_close标记
      // 这是为了确保下次正常关闭时能正确标记
      if (!sessionExists) {
        localStorage.removeItem(normalCloseKey);
      }

      // 添加事件监听
      document.addEventListener("visibilitychange", handlePageClose);
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener("pagehide", handlePageClose);
    } catch (err) {
      const errorMessage = handleError(
        err instanceof Error ? err : new Error(String(err)),
        "初始化表单持久化",
        errorLevel,
        onError
      );
      error.value = errorMessage;
    }
  });

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", handlePageClose);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("pagehide", handlePageClose);
  });

  return {
    formData,
    fileData,
    hasUnsavedChanges,
    uploadProgress,
    error,
    saveFiles,
    clearStorage,
    restoreData,
    clearError,
    getFormDataJson,
    getFileDataJson,
    registerTransformMiddleware,
    registerFieldTransforms,
  };
}
