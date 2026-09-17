import { Card, EmptyState, Tag } from '@qiming/ui';
import { PageHead } from './Shell';
import { LAB_EXHIBITS, LAB_SERVICES, exhibitHref } from './lab-exhibits';

const SUBJECT_TONE = { 数学: 'primary', 物理: 'orange', 化学: 'green', 数理化: 'violet' } as const;

const OPEN_BTN =
  'inline-flex items-center justify-center rounded-[10px] border-[1.5px] border-primary bg-primary px-4 py-[9px] text-[13.5px] font-semibold text-card shadow-btn-sm hover:bg-primary-deep';

export function Lab() {
  return (
    <div>
      <PageHead
        title="实验室"
        sub="实验性能力的展台:讲解件试跑、动态知识图谱、AI 讲题白板。点打开在新页运行,不进正式课表。"
      />

      <h2 className="mb-3 text-[14px] font-bold text-ink-2">实验服务</h2>
      <p className="mb-3 text-[13px] text-ink-3">
        代码在仓库 <code className="mono">labs/</code> 下,需要在本机或内网单独起服务;地址可用 <code className="mono">VITE_LAB_*</code> 环境变量覆盖。
      </p>
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {LAB_SERVICES.map((sv) => (
          <Card key={sv.id} bodyClassName="flex h-full flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-bold leading-snug">{sv.title}</h3>
              <Tag tone={SUBJECT_TONE[sv.subject]}>{sv.subject}</Tag>
            </div>
            <p className="flex-1 text-[13px] leading-relaxed text-ink-2">{sv.summary}</p>
            <div className="text-[12px] text-ink-3">
              <div>起法:<span className="mono">{sv.howToRun}</span></div>
              <div>地址:<span className="mono">{sv.url}</span></div>
            </div>
            <a data-service={sv.id} href={sv.url} target="_blank" rel="noreferrer noopener" className={OPEN_BTN}>
              打开
            </a>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-[14px] font-bold text-ink-2">讲解件展台</h2>
      <p className="mb-3 text-[13px] text-ink-3">审题、分步讲解、总结、动手;单文件 HTML,随管理端静态资源部署。</p>
      {LAB_EXHIBITS.length === 0 ? (
        <Card>
          <EmptyState text="还没有讲解件" hint="把单文件 HTML 放到管理端 public/lab 并登记目录" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {LAB_EXHIBITS.map((ex) => (
            <Card key={ex.id} bodyClassName="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-bold leading-snug">{ex.title}</h3>
                <Tag tone={SUBJECT_TONE[ex.subject]}>{ex.subject}</Tag>
              </div>
              <p className="flex-1 text-[13px] leading-relaxed text-ink-2">{ex.summary}</p>
              <a
                data-exhibit={ex.id}
                href={exhibitHref(ex.file)}
                target="_blank"
                rel="noreferrer noopener"
                className={OPEN_BTN}
              >
                打开
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
