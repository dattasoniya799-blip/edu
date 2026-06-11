import { Card, EmptyState } from '@qiming/ui';
import { PageHead } from './Shell';

/** 空壳页面(B1 仅搭骨架,业务由后续任务卡填充) */
export function Placeholder({ title, sub, hint }: { title: string; sub?: string; hint?: string }) {
  return (
    <div>
      <PageHead title={title} sub={sub} />
      <Card>
        <EmptyState text={`「${title}」将在后续任务中实现`} hint={hint} />
      </Card>
    </div>
  );
}
