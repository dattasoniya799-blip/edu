export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** 无障碍标签 */
  label?: string;
  className?: string;
}

/** 开关(平台设置用):开 = primary 实底,关 = line 底 */
export function Switch({ checked, onChange, disabled, label, className = '' }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-line'
      } ${className}`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-pill bg-card shadow-tab transition-all ${checked ? 'left-[21px]' : 'left-[3px]'}`}
      />
    </button>
  );
}
