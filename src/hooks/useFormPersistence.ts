import type {
  StoredFile,
  UseFormPersistenceReturn,
  UseFormPersistenceOptions,
  UploadProgress,
} from "../types/useFormPersistenceType";
import {
  ref,
  reactive,
  watch,
  onMounted,
  onUnmounted,
  type Reactive,
} from "vue";

// 存储常量
const STORAGE_PREFIX = "form_persistence_";
const DB_NAME = "FormPersistenceDB";
const DB_VERSION = 1;
const DB_STORE_NAME = "form_files";

// 使用原始选项类型
type EnhancedOptions = UseFormPersistenceOptions;

// IndexedDB工具类（带类型约束）
class FileStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
          db.createObjectStore(DB_STORE_NAME, {
            keyPath: "fileId",
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = (e: Event) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (e: Event) => {
        reject((e.target as IDBOpenDBRequest).error);
      };
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
  options: EnhancedOptions
): UseFormPersistenceReturn<T> {
  const { fileFields, clearOnClose = false } = options;

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

    Object.keys(fileDataCopy).forEach(fieldName => {
      // 确保fileDataCopy[fieldName]是数组，避免undefined.map()错误
      if (Array.isArray(fileDataCopy[fieldName])) {
        simplifiedFileData[fieldName] = fileDataCopy[fieldName].map(file => ({
          fileName: file.fileName,
          fileSize: file.fileSize,
          fileType: file.fileType,
          lastModified: file.lastModified
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

  // 恢复数据 - 智能恢复机制，支持崩溃恢复
  const restoreData = async (): Promise<void> => {
    try {
      // 检查sessionKey是否存在（判断是刷新还是重新打开）
      const sessionExists = sessionStorage.getItem(sessionKey) !== null;

      // 检查是否有正常关闭标记
      const isNormalClose = localStorage.getItem(normalCloseKey) === 'true';

      // 检查是否是崩溃恢复场景：session不存在但localStorage有数据且没有正常关闭标记
      const isCrashRecovery = !sessionExists &&
                             localStorage.getItem(storageKey) !== null &&
                             !isNormalClose;

      let formOnly: Partial<T> = {};
      let savedText = sessionStorage.getItem(sessionKey);
      let isFromLocalStorage = false;

      // 优先从sessionStorage恢复
      if (savedText) {
        // 从sessionStorage恢复
        const parsed = JSON.parse(savedText) as Partial<T> & {
          savedAt?: string;
        };

        // 检查数据是否过期（24小时）
        if (parsed.savedAt) {
          const savedTime = new Date(parsed.savedAt).getTime();
          const now = new Date().getTime();
          const HOUR_24 = 24 * 60 * 60 * 1000;

          if (now - savedTime > HOUR_24) {
            sessionStorage.removeItem(sessionKey);
            savedText = null; // 标记需要尝试从localStorage恢复
          } else {
            // 移除savedAt字段，只恢复表单数据
            const formDataWithoutTimestamp = { ...parsed };
            delete formDataWithoutTimestamp.savedAt;
            formOnly = formDataWithoutTimestamp as Partial<T>;
          }
        } else {
          // 移除可能存在的savedAt字段
          const formDataWithoutTimestamp = { ...parsed };
          delete formDataWithoutTimestamp.savedAt;
          formOnly = formDataWithoutTimestamp as Partial<T>;
        }
      }

      // 如果sessionStorage恢复失败且是崩溃恢复场景，尝试从localStorage恢复
      if (!savedText && isCrashRecovery) {
        const localStorageText = localStorage.getItem(storageKey);
        if (localStorageText) {
          try {
            const parsed = JSON.parse(localStorageText) as Partial<T> & {
              savedAt?: string;
            };

            // 检查数据是否过期（24小时）
            if (parsed.savedAt) {
              const savedTime = new Date(parsed.savedAt).getTime();
              const now = new Date().getTime();
              const HOUR_24 = 24 * 60 * 60 * 1000;

              if (now - savedTime > HOUR_24) {
              localStorage.removeItem(storageKey);
            } else {
              // 移除savedAt字段，只恢复表单数据
              const formDataWithoutTimestamp = { ...parsed };
              delete formDataWithoutTimestamp.savedAt;
              formOnly = formDataWithoutTimestamp as Partial<T>;
              isFromLocalStorage = true;

                // 将恢复的数据同步到sessionStorage，保持现有逻辑
                sessionStorage.setItem(sessionKey, localStorageText);
              }
            }
          } catch (parseError) {
            // 静默处理解析错误
          }
        }
      }

      // 应用恢复的数据
      if (Object.keys(formOnly).length > 0) {
        Object.assign(formData, formOnly);
      }

      // 动态恢复所有传入的文件字段
      try {
        // 关键逻辑：如果sessionKey存在（刷新操作）或从localStorage恢复（崩溃恢复），才从IndexedDB恢复文件
        if (sessionExists || isFromLocalStorage) {
          for (const field of fileFields) {
            fileData[field] = await fileStorage.getFiles(formId, field);
          }
        } else if (!isNormalClose && localStorage.getItem(storageKey) !== null) {
          // 即使不是从localStorage恢复文本数据，也尝试恢复文件（可能是部分恢复情况）
          for (const field of fileFields) {
            fileData[field] = await fileStorage.getFiles(formId, field);
          }
        }
      } catch (fileError) {
        // 静默处理文件恢复错误，不阻止文本数据恢复
      }

      // 检查是否有实际数据被恢复，正确更新响应式状态
      const hasData = Object.values(formData).some(
        (val) => val !== null && val !== undefined && val !== ""
      );
      const hasFiles = Object.values(fileData).some(
        (files) => files.length > 0
      );
      hasUnsavedChanges.value = hasData || hasFiles;
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
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
      const dataWithTimestamp = {
        ...formData,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify(dataWithTimestamp));
      sessionStorage.setItem(sessionKey, JSON.stringify(dataWithTimestamp));
      hasUnsavedChanges.value = true;
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  };

  // 保存文件
  const saveFiles = async (fieldName: string, files: File[]): Promise<void> => {
    try {
      error.value = null;
      uploadProgress.value = null;

      // 只删除当前字段的旧文件（使用公共方法获取事务）
      const oldFiles = await fileStorage.getFiles(formId, fieldName);
      if (oldFiles.length > 0) {
        // 通过 getTransaction 方法获取事务，避免直接访问 db
        const transaction = fileStorage.getTransaction("readwrite");
        const store = transaction.objectStore(DB_STORE_NAME);
        for (const oldFile of oldFiles) {
          await new Promise((resolve, reject) => {
            const request = store.delete(oldFile.fileId);
            request.onsuccess = resolve;
            request.onerror = reject;
          });
        }
      }

      // 保存新文件，添加进度跟踪
      const newFiles: StoredFile[] = [];
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      let loadedSize = 0;

      for (const file of files) {

        const fileId = await fileStorage.saveFile(
          file,
          formId,
          fieldName,
          (loaded, _total) => {
            // 更新上传进度
            // 使用_total作为占位符，表示我们知道这个参数但当前不需要使用它
            // 上传进度计算 - 修正逻辑
            const fileProgressLoaded = loaded;
            // 计算当前文件进度对总进度的贡献
            const percent = Math.round(
              ((loadedSize + fileProgressLoaded) / totalSize) * 100
            );

            uploadProgress.value = {
              fieldName,
              total: totalSize,
              loaded: loadedSize,
              percent,
            };

            // 进度信息不再记录为日志
          }
        );

        const savedFiles = await fileStorage.getFiles(formId, fieldName);
        const savedFile = savedFiles.find((f) => f.fileId === fileId);
        if (savedFile) {
          newFiles.push(savedFile);
          loadedSize += file.size;
        }
      }

      fileData[fieldName] = newFiles;
      hasUnsavedChanges.value = true;
      uploadProgress.value = null; // 上传完成，清除进度
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
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

    // 设置正常关闭标记
    localStorage.setItem(normalCloseKey, 'true');
  };

  // 清理存储
  const clearStorage = async (): Promise<void> => {
    try {
      // 清除sessionStorage数据
      sessionStorage.removeItem(sessionKey);
      // 详细步骤不再单独记录

      // 清除localStorage数据
      localStorage.removeItem(storageKey);
      // 清除正常关闭标记
      localStorage.removeItem(normalCloseKey);
      // 详细步骤不再单独记录

      // 清除IndexedDB数据
      await fileStorage.clearFiles(formId);
      // 详细步骤不再单独记录

      hasUnsavedChanges.value = false;
      error.value = null;

      // 清空文件数据
      for (const field of fileFields) {
        fileData[field] = [];
      }

    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  };

  // 监听表单数据变化
  watch(formData, () => saveTextData(), { deep: true });

  // 生命周期
  onMounted(async () => {
    // 初始化fileStorage
    await fileStorage.init();

    // 检查sessionKey是否存在（判断是刷新还是重新打开）
    const sessionExists = sessionStorage.getItem(sessionKey) !== null;

    // 检查是否有正常关闭标记
    const isNormalClose = localStorage.getItem(normalCloseKey) === 'true';

    // 智能清理逻辑：
    // 1. 如果是正常关闭后重新打开且clearOnClose=true，清理所有数据
    // 2. 崩溃恢复场景不清理数据
    if (!sessionExists && isNormalClose && clearOnClose) {
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
          // 静默处理清理错误
        }
      }

    // 恢复数据（包括文件）
    await restoreData();

    // 添加事件监听
    document.addEventListener("visibilitychange", handlePageClose);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageClose);
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
    getFileDataJson
  };
}
