import { elements } from '../../styles/design-tokens';
import { ELEMENT_GLYPHS } from './elementGlyphs';
import './../../styles/element-icon.css';

type ElementKey = keyof typeof elements;

const SIZES: Record<ElementIconSize, number> = { xs: 16, sm: 20, md: 26, lg: 36 };

export type ElementIconSize = 'xs' | 'sm' | 'md' | 'lg';
export type ElementIconVariant = 'bare' | 'badge';

export interface ElementIconProps {
  /** Canonical element key (`plant` for the oak-leaf glyph). Tolerant of unknown/null. */
  readonly element?: string | null;
  readonly size?: ElementIconSize;
  /** `bare` = glyph only; `badge` = notch-clipped surface with element glow. */
  readonly variant?: ElementIconVariant;
  /** Render the element name next to the glyph (badge keeps the text outside the notch). */
  readonly label?: boolean;
  readonly title?: string;
}

export function ElementIcon({
  element,
  size = 'sm',
  variant = 'bare',
  label = false,
  title,
}: ElementIconProps): JSX.Element {
  const key = (element && element in elements ? element : 'null') as ElementKey;
  const color = elements[key];
  const glyph = ELEMENT_GLYPHS[key];
  const px = SIZES[size];
  const pad = variant === 'badge' ? 3 : 0;
  const box = pad ? { width: px + pad * 2, height: px + pad * 2 } : undefined;

  return (
    <span
      className={`element-icon element-icon--${variant} element-icon--size-${size}`}
      style={{ ['--ec' as string]: color }}
      title={title ?? key}
      aria-label={title ?? key}
    >
      <span className="element-icon__glyph" style={box}>
        <svg viewBox="0 0 512 512" width={px} height={px} aria-hidden="true">
          <g transform="translate(256 256) scale(0.74) translate(-256 -256)">
            <path d={glyph} />
          </g>
        </svg>
      </span>
      {label ? <span className="element-icon__label">{key}</span> : null}
    </span>
  );
}