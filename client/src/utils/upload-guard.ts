/** 所有上传入口统一的体积上限 5MB（与服务端一致，服务端会再挡一次） */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 超限返回提示文案；未超限返回 null */
export function uploadSizeError(file: { size: number; name: string }, maxBytes = MAX_UPLOAD_BYTES): string | null {
  if (file.size <= maxBytes) return null;
  return `「${file.name}」${formatMb(file.size)}MB，超过 5MB 上限，请压缩后再上传`;
}
