/** 难度三点徽标(组卷选题/已选列表共用) */
export function DiffDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5 align-[-1px]">
      {[1, 2, 3].map((i) => (
        <i key={i} className={`h-[7px] w-[7px] rounded-[2px] ${i <= level ? 'bg-orange' : 'bg-line'}`} />
      ))}
    </span>
  );
}
