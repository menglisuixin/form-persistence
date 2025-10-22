# Form Persistence

表单数据持久化库，支持检测正常退出和异常退出（如崩溃），并在异常退出后恢复表单数据，同时提供文件上传进度监控功能。

## 功能特性

- ✨ 自动保存表单数据到localStorage
- 🔍 智能检测正常退出和异常退出
- 📁 支持文件数据的保存和恢复
- 📊 提供上传进度监控
- ⚙️ 高度可配置的错误处理机制
- 📱 完全支持Vue 3 Composition API
- 🛡️ 完整的TypeScript类型支持

## 安装

使用npm安装：
```bash
npm install form-persistence
```

使用yarn安装：
```bash
yarn add form-persistence
```

使用pnpm安装：
```bash
pnpm add form-persistence
```

## 基本使用

```vue
<script setup lang="ts">
import { useFormPersistence } from 'form-persistence';
import { ref } from 'vue';

// 定义表单数据类型
interface FormData {
  username: string;
  email: string;
  age: number | null;
  gender: string;
  hobbies: string[];
  message: string;
}

// 初始化表单数据
const initialFormData = {
  username: '',
  email: '',
  age: null,
  gender: '',
  hobbies: [],
  message: ''
};

// 使用持久化Hook
const {
  formData,
  hasUnsavedChanges,
  clearStorage,
  getFormDataJson
} = useFormPersistence<FormData>('test-persistent-form', {
  fileFields: [], // 文件字段名称列表
  clearOnClose: true, // 正常关闭时是否清除数据
  dataExpiryMs: 24 * 60 * 60 * 1000, // 数据过期时间（24小时）
  errorLevel: 'basic' // 错误报告级别
});

// 处理表单提交
const handleSubmit = () => {
  console.log('提交表单数据:', formData);
  // 提交成功后清除存储的数据
  clearStorage();
};

// 手动保存数据
const saveData = () => {
  console.log('当前表单数据JSON:', getFormDataJson());
};
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <div>
      <label for="username">用户名:</label>
      <input
        id="username"
        v-model="formData.username"
        type="text"
        placeholder="请输入用户名"
      />
    </div>

    <div>
      <label for="email">邮箱:</label>
      <input
        id="email"
        v-model="formData.email"
        type="email"
        placeholder="请输入邮箱"
      />
    </div>

    <div>
      <label for="age">年龄:</label>
      <input
        id="age"
        v-model.number="formData.age"
        type="number"
        placeholder="请输入年龄"
      />
    </div>

    <div>
      <label>性别:</label>
      <input
        type="radio"
        id="male"
        v-model="formData.gender"
        value="male"
      />
      <label for="male">男</label>
      <input
        type="radio"
        id="female"
        v-model="formData.gender"
        value="female"
      />
      <label for="female">女</label>
    </div>

    <div>
      <label>爱好:</label>
      <input
        type="checkbox"
        id="reading"
        value="reading"
        v-model="formData.hobbies"
      />
      <label for="reading">阅读</label>
      <input
        type="checkbox"
        id="sports"
        value="sports"
        v-model="formData.hobbies"
      />
      <label for="sports">运动</label>
    </div>

    <div>
      <label for="message">留言:</label>
      <textarea
        id="message"
        v-model="formData.message"
        placeholder="请输入留言"
      ></textarea>
    </div>

    <div v-if="hasUnsavedChanges" style="color: #f56c6c; margin-bottom: 10px;">
      您有未保存的更改
    </div>

    <div>
      <button type="button" @click="saveData">保存数据</button>
      <button type="submit">提交表单</button>
      <button type="button" @click="clearStorage">清除数据</button>
    </div>
  </form>
</template>
```

## 支持文件上传

```vue
<script setup lang="ts">
import { useFormPersistence } from 'form-persistence';

interface FormData {
  title: string;
  description: string;
}

const initialFormData = {
  title: '',
  description: ''
};

const {
  formData,
  fileData,
  uploadProgress,
  saveFiles
} = useFormPersistence<FormData>('file-upload-form', {
  fileFields: ['attachments', 'avatar'], // 文件字段名称列表
  clearOnClose: false
});

// 处理文件选择
const handleFileChange = async (event: Event, fieldName: string) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    try {
      await saveFiles(fieldName, Array.from(target.files));
      console.log(`已保存 ${fieldName} 字段的文件`);
    } catch (error) {
      console.error('保存文件失败:', error);
    }
  }
};
</script>

<template>
  <form>
    <div>
      <label for="title">标题:</label>
      <input
        id="title"
        v-model="formData.title"
        type="text"
        placeholder="请输入标题"
      />
    </div>

    <div>
      <label for="description">描述:</label>
      <textarea
        id="description"
        v-model="formData.description"
        placeholder="请输入描述"
      ></textarea>
    </div>

    <div>
      <label for="attachments">附件:</label>
      <input
        id="attachments"
        type="file"
        multiple
        @change="(e) => handleFileChange(e, 'attachments')"
      />
    </div>

    <div>
      <label for="avatar">头像:</label>
      <input
        id="avatar"
        type="file"
        accept="image/*"
        @change="(e) => handleFileChange(e, 'avatar')"
      />
    </div>

    <!-- 显示上传进度 -->
    <div v-if="uploadProgress">
      {{ uploadProgress.fieldName }}: {{ uploadProgress.percent }}%
      <progress :value="uploadProgress.percent" max="100"></progress>
    </div>

    <!-- 显示已保存的文件 -->
    <div v-for="(files, fieldName) in fileData" :key="fieldName">
      <h4>{{ fieldName }} 文件:</h4>
      <ul>
        <li v-for="file in files" :key="file.fileId">
          {{ file.fileName }} ({{ file.fileSize }} bytes)
        </li>
      </ul>
    </div>
  </form>
</template>
```

## API

### useFormPersistence<T>(formId, options)

#### 参数

- **formId**: `string` - 表单的唯一标识符
- **options**: `UseFormPersistenceOptions` - 配置选项
  - **fileFields**: `string[]` - 文件字段名称列表
  - **clearOnClose**: `boolean` (可选) - 页面正常关闭时是否清除数据，默认 `false`
  - **dataExpiryMs**: `number` (可选) - 数据过期时间（毫秒），默认 24 小时
  - **errorLevel**: `ErrorLevel` (可选) - 错误报告级别，可选值: `'none'`, `'basic'`, `'detailed'`
  - **onError**: `(error: Error, context: string) => void` (可选) - 自定义错误处理函数

#### 返回值

- **formData**: `Reactive<T>` - 响应式表单数据
- **fileData**: `Reactive<Record<string, StoredFile[]>>` - 响应式文件数据
- **hasUnsavedChanges**: `Ref<boolean>` - 是否有未保存的更改
- **uploadProgress**: `Ref<UploadProgress | null>` - 当前上传进度
- **error**: `Ref<string | null>` - 当前错误信息
- **saveFiles**: `(fieldName: string, files: File[]) => Promise<void>` - 保存文件的函数
- **clearStorage**: `() => Promise<void>` - 清除存储数据的函数
- **restoreData**: `() => Promise<void>` - 恢复数据的函数
- **clearError**: `() => void` - 清除错误的函数
- **getFormDataJson**: `() => string` - 获取表单数据JSON字符串的函数
- **getFileDataJson**: `() => string` - 获取文件数据JSON字符串的函数

## 类型定义

### StoredFile

```typescript
interface StoredFile {
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
```

### UploadProgress

```typescript
interface UploadProgress {
  fieldName: string;
  total: number;
  loaded: number;
  percent: number;
}
```

### UseFormPersistenceOptions

```typescript
interface UseFormPersistenceOptions {
  fileFields: string[];
  clearOnClose?: boolean;
  dataExpiryMs?: number;
  errorLevel?: ErrorLevel;
  onError?: (error: Error, context: string) => void;
}
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 问题反馈

如有任何问题或建议，请在 [GitHub Issues](https://github.com/yourusername/form-persistence/issues) 中提交。
