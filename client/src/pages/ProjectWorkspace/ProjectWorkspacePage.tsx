import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wrench } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import { Card, CardContent } from '@client/src/components/ui/card';

const ProjectWorkspacePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          className="h-9 w-9"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">项目工作台</h1>
          <p className="mt-1 text-sm text-slate-500">项目 ID: {id}</p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center py-16">
          <Wrench className="h-12 w-12 text-slate-300 mb-4" />
          <p className="text-sm text-slate-500 mb-2">工作台建设中</p>
          <p className="text-xs text-slate-400">
            此页面正在开发中，敬请期待
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectWorkspacePage;
