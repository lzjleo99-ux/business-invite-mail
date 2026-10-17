import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectMaterial,
  UploadMaterialByBase64Request,
} from '@shared/api.interface';

export async function getProjects(): Promise<Project[]> {
  const response = await axiosForBackend.get('/api/projects');
  return response.data;
}

export async function getProject(id: string): Promise<Project> {
  const response = await axiosForBackend.get(`/api/projects/${id}`);
  return response.data;
}

export async function createProject(
  data: CreateProjectRequest,
): Promise<Project> {
  const response = await axiosForBackend.post('/api/projects', data);
  return response.data;
}

export async function updateProject(
  id: string,
  data: UpdateProjectRequest,
): Promise<Project> {
  const response = await axiosForBackend.patch(`/api/projects/${id}`, data);
  return response.data;
}

export async function deleteProject(id: string): Promise<void> {
  await axiosForBackend.delete(`/api/projects/${id}`);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadProjectImage(projectId: string, file: File): Promise<Project> {
  const contentBase64: string = await readFileAsBase64(file);
  const body: UploadMaterialByBase64Request = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64,
  };
  const response = await axiosForBackend.post(
    `/api/projects/${projectId}/images-base64`,
    body,
    { maxContentLength: 30 * 1024 * 1024, maxBodyLength: 30 * 1024 * 1024 },
  );
  return response.data;
}

export async function deleteProjectImage(projectId: string, imageId: string): Promise<Project> {
  const response = await axiosForBackend.delete(`/api/projects/${projectId}/images/${imageId}`);
  return response.data;
}

export async function uploadMaterial(
  projectId: string,
  file: File,
): Promise<ProjectMaterial> {
  const contentBase64: string = await readFileAsBase64(file);
  const body: UploadMaterialByBase64Request = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64,
  };
  const response = await axiosForBackend.post(
    `/api/projects/${projectId}/materials-base64`,
    body,
    { maxContentLength: 30 * 1024 * 1024, maxBodyLength: 30 * 1024 * 1024 },
  );
  return response.data;
}

export async function deleteMaterial(projectId: string, materialId: string): Promise<void> {
  await axiosForBackend.delete(`/api/projects/${projectId}/materials/${materialId}`);
}

/**
 * 预览/下载素材文件。
 * 浏览器直接开 URL 带不上 JWT（Authorization 头只由 axios 拦截器注入），
 * 所以先以 blob 拉回再走 objectURL：图片/PDF 在新标签页内联打开，
 * 其余类型（xlsx/docx…）浏览器按 content-type 落盘下载。
 */
export async function downloadMaterial(projectId: string, materialId: string): Promise<void> {
  const response = await axiosForBackend.get(
    `/api/projects/${projectId}/materials/${materialId}/download`,
    { responseType: 'blob' },
  );
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } finally {
    // 立即 revoke 会中断新标签页加载，给浏览器留出读取时间
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * 拉取素材字节并返回 objectURL（邮件正文里内联展示图片用）。
 * 调用方负责 URL.revokeObjectURL（组件卸载时）。
 */
export async function getMaterialObjectUrl(projectId: string, materialId: string): Promise<string> {
  const response = await axiosForBackend.get(
    `/api/projects/${projectId}/materials/${materialId}/download`,
    { responseType: 'blob' },
  );
  return URL.createObjectURL(response.data as Blob);
}
