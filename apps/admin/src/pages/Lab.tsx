import { Card, EmptyState, Tag } from '@qiming/ui';
import { PageHead } from './Shell';
import { LAB_EXHIBITS, exhibitHref } from './lab-exhibits';

const SUBJECT_TONE = { 数学: 'primary', 物理: 'orange' } as const;

export function Lab() {
  return (
    <div>
      <PageHead
        title="实验室"
        sub="讲解件试跑展台:审题、分步讲解、总结、动手。点打开在新页播放,不进正式课表。"
      />
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
                className="inline-flex items-center justify-center rounded-[10px] border-[1.5px] border-primary bg-primary px-4 py-[9px] text-[13.5px] font-semibold text-card shadow-btn-sm hover:bg-primary-deep"
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
