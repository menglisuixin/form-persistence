<template>
  <div class="form-container">
    <h2>TypeScript表单持久化示例</h2>

    <!-- 错误提示 -->
    <div v-if="error" class="error-message">
      <span>{{ error }}</span>
      <button type="button" @click="clearError" class="error-close">×</button>
    </div>

    <!-- 上传进度条 -->
    <div v-if="uploadProgress" class="progress-container">
      <div class="progress-info">
        <span
          >{{ uploadProgress.fieldName }}: {{ uploadProgress.percent }}%</span
        >
        <span
          >{{ formatFileSize(uploadProgress.loaded) }} /
          {{ formatFileSize(uploadProgress.total) }}</span
        >
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: uploadProgress.percent + '%' }"
        ></div>
      </div>
    </div>

    <form @submit.prevent="handleSubmit">
      <!-- 文本字段 -->
      <div class="form-group">
        <label>用户名：</label>
        <input
          v-model="formData.username"
          type="text"
          placeholder="请输入用户名"
        />
      </div>

      <div class="form-group">
        <label>邮箱：</label>
        <input v-model="formData.email" type="email" placeholder="请输入邮箱" />
      </div>

      <div class="form-group">
        <label>地址：</label>
        <textarea
          v-model="formData.address"
          placeholder="请输入地址（可离开页面后返回继续编辑）"
        ></textarea>
      </div>

      <!-- 单文件上传 -->
      <div class="form-group">
        <label>头像（单文件）：</label>
        <input
          type="file"
          accept="image/*"
          @change="
            handleFileChange(
              'avatar',
              ($event.target as HTMLInputElement).files
            )
          "
        />
        <div class="preview" v-if="fileData.avatar && fileData.avatar.length">
          <img
            :src="fileData.avatar[0] ? getBlobUrl(fileData.avatar[0]) : ''"
            alt="头像预览"
            class="avatar-preview"
          />
        </div>
      </div>

      <!-- 多文件上传 -->
      <div class="form-group">
        <label>附件（多文件）：</label>
        <input
          type="file"
          multiple
          @change="
            handleFileChange(
              'attachments',
              ($event.target as HTMLInputElement).files
            )
          "
        />
        <div
          class="file-list"
          v-if="fileData.attachments && fileData.attachments.length"
        >
          <div
            v-for="file in fileData.attachments"
            :key="file.fileId"
            class="file-item"
          >
            {{ file.fileName }} ({{ formatSize(file.fileSize) }})
          </div>
        </div>
      </div>

      <!-- 文件夹上传 -->
      <div class="form-group">
        <label>文件夹：</label>
        <input
          type="file"
          webkitdirectory
          directory
          @change="
            handleFileChange(
              'folder',
              ($event.target as HTMLInputElement).files
            )
          "
        />
        <div class="file-list" v-if="fileData.folder && fileData.folder.length">
          <div
            v-for="file in fileData.folder"
            :key="file.fileId"
            class="file-item"
          >
            📂 {{ file.fileName }}
          </div>
        </div>
      </div>

      <button type="submit" class="submit-btn">提交表单</button>
      <button type="button" @click="handleClearStorage" class="clear-btn">
        清除缓存数据
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useFormPersistence } from "../hooks/useFormPersistence";
import { onUnmounted } from "vue";
import type { StoredFile } from "../types/useFormPersistenceType";

// 定义表单数据类型
interface FormData {
  username: string;
  email: string;
  address: string;
}
const fileFields = ["avatar", "attachments", "folder"]; // 组件自己的文件字段
// 自动日志回调 - 在组件中完全控制日志内容和格式
// 移除日志回调函数

// 错误处理回调
const handleFormError = (error: Error, context: string) => {
  console.error(`表单错误 [${context}]:`, error);
  // 这里可以根据需要展示自定义错误提示
  // 例如：使用更友好的UI组件显示错误
};

// 初始化表单（指定类型）
const {
  formData,
  fileData,
  uploadProgress,
  error,
  saveFiles,
  clearStorage,
  clearError,
  getFormDataJson,
  getFileDataJson,
} = useFormPersistence<FormData>(
  "example_form",
  {
    username: "",
    email: "",
    address: "",
  },
  {
    fileFields,
    clearOnClose: true, // 启用页面关闭时清除数据
    dataExpiryMs: 8 * 60 * 60 * 1000, // 自定义过期时间为8小时
    errorLevel: "detailed", // 详细错误报告
    onError: handleFormError, // 自定义错误处理回调
  }
);

// 处理文件选择
const handleFileChange = async (fieldName: string, files: FileList | null) => {
  if (files && files.length > 0) {
    try {
      await saveFiles(fieldName, Array.from(files));
      // 文件保存成功，错误会通过error响应式引用自动处理
    } catch (err) {
      // 这里可以添加额外的业务逻辑处理
      // 注意：错误已经在useFormPersistence中通过onError回调处理了
    }
  }
};

// 格式化文件大小为可读格式
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 生成文件预览URL
const blobUrls: string[] = [];
const getBlobUrl = (file: StoredFile): string => {
  const blob = new Blob([file.data], { type: file.fileType });
  const url = URL.createObjectURL(blob);
  blobUrls.push(url);
  return url;
};

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes > 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + "MB";
  }
  return (bytes / 1024).toFixed(2) + "KB";
};

// 表单提交
const handleSubmit = () => {
  // 获取表单数据JSON
  const formJson = getFormDataJson();
  // 获取文件数据JSON
  const fileJson = getFileDataJson();

  // 这里可以使用这些JSON数据进行后续处理
  console.log("表单数据JSON:", formJson);
  console.log("文件数据JSON:", fileJson);

  // 模拟提交
  alert("表单提交成功！\n\n表单数据JSON已获取，可用于后续处理。");
};

// 清除缓存数据
const handleClearStorage = async () => {
  if (confirm("确定要清除所有缓存数据吗？此操作不可恢复。")) {
    try {
      await clearStorage();
      alert("缓存数据已成功清除！");
    } catch (err) {
      console.error("清除缓存失败:", err);
      alert("清除缓存失败，请稍后重试。");
    }
  }
};

// 组件卸载时释放Blob URL
onUnmounted(() => {
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
});
</script>

<style scoped>
/* 样式同前文，略 */
.form-container {
  max-width: 600px;
  margin: 20px auto;
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
}

.form-group {
  margin-bottom: 15px;
}

label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
}

input,
textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

textarea {
  min-height: 100px;
  resize: vertical;
}

.preview {
  margin-top: 10px;
}

.avatar-preview {
  width: 150px;
  height: 150px;
  object-fit: cover;
  border-radius: 4px;
}

.file-list {
  margin-top: 10px;
}

.file-item {
  padding: 5px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 5px;
  font-size: 14px;
}

.submit-btn {
  margin-top: 20px;
  padding: 10px 20px;
  background: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.submit-btn:hover {
  background: #359e75;
}

/* 错误提示样式 */
.error-message {
  background-color: #f8d7da;
  color: #721c24;
  padding: 10px 15px;
  border-radius: 4px;
  margin-bottom: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #f5c6cb;
}

.error-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #721c24;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 进度条样式 */
.progress-container {
  margin-bottom: 15px;
  background-color: #f8f9fa;
  padding: 10px 15px;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 14px;
  color: #666;
}

.progress-bar {
  width: 100%;
  height: 20px;
  background-color: #e9ecef;
  border-radius: 10px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #42b983;
  transition: width 0.3s ease;
}
</style>
