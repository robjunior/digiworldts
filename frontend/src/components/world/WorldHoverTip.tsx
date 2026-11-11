import type { CSSProperties } from 'react';

const elVar = (el: string) => `var(--el-${el})`;

export type WorldHoverTipData = {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly el: string;
  readonly rawEl: string;
};

type WorldHoverTipProps = {
  readonly tip: WorldHoverTipData | null;
};

export function WorldHoverTip({ tip }: WorldHoverTipProps): JSX.Element | null {
  if (!tip) return null;
  
  return (
    <div className="rtip show" id="rtip" style={{ left: tip.x, top: tip.y, '--el': elVar(tip.rawEl) } as CSSProperties}>
      <span id="rtip-name">{tip.name}</span>
      <span className="re" id="rtip-el">{tip.el}</span>
    </div>
  );
}
