/**
 * 实验室(E1):内测功能的统一入口。
 * 列表来自 GET /features/my —— 服务端已按阶段 + 白名单 + 角色过滤,前端只负责渲染与跳转。
 * 「AI 生成课件」从资源库正式入口迁到这里,路由 /courseware/new 不变。
 */
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Tag } from '@qiming/ui';
import { useFeatures } from '../../features/FeaturesProvider';
import { PageHead } from '../Shell';

const STAGE_TAG = {
  beta: { tone: 'violet' as const, label: '内测' },
  ga: { tone: 'green' as const, label: '已转正' },
};

export function LabPage() {
  const navigate = useNavigate();
  const { features, labEntries } = useFeatures();

  return (
    <div>
      <PageHead
        title="实验室"
        sub="内测中的新功能:先在白名单账号里试用,收够反馈再转成正式功能 · 用着有问题请直接反馈给管理员"
      />

      {features == null ? (
        <div className="py-10 text-center text-[13px] text-ink-3">加载中…</div>
      ) : labEntries.length === 0 ? (
        <Card>
          <EmptyState
            icon="🧪"
            text="暂时没有对你开放的内测功能"
            hint="内测功能按账号白名单开放,需要试用请联系机构管理员在「实验室管理」里开通"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
          {labEntries.map((f) => {
            const stage = STAGE_TAG[f.stage];
            return (
              <div key={f.key} className="flex flex-col gap-2.5 rounded-lg border border-line bg-card p-5 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="text-[17px]" aria-hidden>{f.icon}</span>
                  <b className="text-[15px]">{f.name}</b>
                  <Tag tone={stage.tone} className="ml-auto">{stage.label}</Tag>
                </div>
                <p className="flex-1 text-[13px] leading-6 text-ink-2">{f.description}</p>
                <div>
                  <Button variant="primary" onClick={() => navigate(f.to)}>进入</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
