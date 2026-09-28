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
