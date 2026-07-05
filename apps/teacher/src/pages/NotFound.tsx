import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState } from '@qiming/ui';
import { PageHead } from './Shell';

/** 真实 404 空态:未匹配任何路由时的兜底页(返回首页可回到工作台) */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <div>
      <PageHead title="页面不存在" />
      <Card>
        <EmptyState
          icon="⊘"
          text="页面不存在或已被移动"
          hint="请检查链接是否正确,或返回首页继续操作"
          action={<Button variant="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </Card>
    </div>
  );
}
