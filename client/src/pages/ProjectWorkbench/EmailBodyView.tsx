import React, { useEffect } from 'react';
import { isHtmlBody, stripHtmlPrefix } from '@client/src/components/RichEmailEditor';
import { useQuery } from '@tanstack/react-query';

import { getMaterialObjectUrl } from '@client/src/api/projects';
import {
  parseEmailBody,
} from '@client/src/utils/email-body';

interface EmailBodyViewProps {
  body: string;
  projectId: string | null | undefined;
}

/**
 * 邮件正文查看态渲染：[[IMG:<素材ID>]] 标记 → 内联图片（图注随其下），
 * 其余按原样文本渲染。无标记时与纯文本渲染完全一致。
 */
const EmailBodyView: React.FC<EmailBodyViewProps> = ({ body, projectId }) => {
  // 富文本正文（<!--html--> 哨兵）：按 HTML 渲染（去掉 script/style）
  if (isHtmlBody(body)) {
    const html = stripHtmlPrefix(body)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    return (
      <div
        className="text-sm text-slate-700 email-body-html"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const segments = parseEmailBody(body);

  if (!segments.some((s) => s.type === 'image')) {
    return <p className="text-sm text-slate-700 whitespace-pre-wrap">{body}</p>;
  }

  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <p key={i} className="text-sm text-slate-700 whitespace-pre-wrap">
            {seg.text}
          </p>
        ) : (
          <EmailImage
            key={i}
            projectId={projectId}
            materialId={seg.materialId}
            caption={seg.caption}
          />
        ),
      )}
    </div>
  );
};

const EmailImage: React.FC<{
  projectId: string | null | undefined;
  materialId: string;
  caption: string;
}> = ({ projectId, materialId, caption }) => {
  const { data: url } = useQuery({
    queryKey: ['material-image', projectId, materialId],
    queryFn: () => getMaterialObjectUrl(projectId as string, materialId),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  // objectURL 用完即废：url 变更/组件卸载时回收，防内存泄漏
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <figure className="my-2">
      {url ? (
        <img
          src={url}
          alt={caption || 'material'}
          className="max-h-72 w-auto max-w-full rounded-lg border border-slate-200"
        />
      ) : (
        <div className="h-40 w-full max-w-md animate-pulse rounded-lg bg-slate-100" />
      )}
      {caption && (
        <figcaption className="mt-1 text-center text-xs text-slate-500">
          {caption}
        </figcaption>
      )}
    </figure>
  );
};

export default EmailBodyView;
