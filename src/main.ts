// 先导入useFormPersistence
import { useFormPersistence } from './hooks/useFormPersistence';
// 重新导出
import type {
  StoredFile,
  UploadProgress,
  UseFormPersistenceReturn,
  UseFormPersistenceOptions,
  ErrorLevel
} from './types/useFormPersistenceType';

// 命名导出
export { useFormPersistence };
export type {
  StoredFile,
  UploadProgress,
  UseFormPersistenceReturn,
  UseFormPersistenceOptions,
  ErrorLevel
};

// 默认导出
export default useFormPersistence;

// 应用入口代码（仅在直接运行时执行）
if (import.meta.env.DEV) {
  import('./assets/style.scss');
  import('vue').then(({ createApp }) => {
    import('./App.vue').then((AppModule) => {
      // 处理可能的不同模块导出格式
      const App = AppModule.default || AppModule;
      createApp(App).mount('#app');
    });
  });
}
