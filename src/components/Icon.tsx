import type { CSSProperties } from 'react';

/** 統一的線性圖示集（inline SVG，不依賴外部字型或圖示套件）。 */

export type IconName =
  | 'search'
  | 'filter'
  | 'universe'
  | 'map'
  | 'timeline'
  | 'browse'
  | 'close'
  | 'layers'
  | 'play'
  | 'pause'
  | 'reset'
  | 'chevron'
  | 'chevronLeft'
  | 'chevronRight'
  | 'external'
  | 'source'
  | 'claim'
  | 'evidence'
  | 'expand'
  | 'target'
  | 'info'
  | 'sparkle'
  | 'eye'
  | 'demo'
  | 'zoomIn'
  | 'zoomOut'
  | 'compass'
  | 'clock'
  | 'link'
  | 'check'
  | 'plus'
  | 'minus'
  | 'menu'
  | 'panelLeft'
  | 'panelRight'
  | 'pin'
  | 'arrowRight'
  | 'help'
  | 'share';

const PATHS: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2',
  filter: 'M3 5h18M6 12h12M10 19h4',
  universe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c3 3 3 15 0 18M3.5 9c5-2 12-2 17 0M3.5 15c5 2 12 2 17 0',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  timeline: 'M4 7h9M8 12h12M5 17h8M15 7h5M4 12h4',
  browse: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
  close: 'M6 6l12 12M18 6 6 18',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  play: 'M8 5v14l11-7-11-7Z',
  pause: 'M9 5v14M15 5v14',
  reset: 'M4 10a8 8 0 1 1 2 8M4 4v6h6',
  chevron: 'M8 10l4 4 4-4',
  chevronLeft: 'M14 7l-5 5 5 5',
  chevronRight: 'M10 7l5 5-5 5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  source: 'M5 4h9l5 5v11H5zM14 4v5h5M8 13h8M8 16h5',
  claim: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  evidence: 'M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  expand: 'M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5',
  target: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5M12 8h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9L18 16Z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  demo: 'M12 3l7 4v10l-7 4-7-4V7l7-4ZM12 8v8M8.5 10l7 4M15.5 10l-7 4',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2M8 11h6',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5.5-5.5 2 2-5.5 5.5-2Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3.5 2',
  link: 'M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3',
  check: 'M5 13l4 4L19 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  panelLeft: 'M4 5h16v14H4zM10 5v14',
  panelRight: 'M4 5h16v14H4zM14 5v14',
  pin: 'M12 3v9M8 12h8l-1 5H9l-1-5ZM12 17v4',
  arrowRight: 'M4 12h15M13 6l6 6-6 6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.5a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1 1-1.1 1.7v.5M12 17h.01',
  share: 'M8 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM16 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM16 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM9.8 13.2l4.4-2.4M9.8 14.8l4.4 2.4',
};

interface IconProps {
  name: IconName | string;
  size?: number;
  style?: CSSProperties;
  className?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 16, style, className, strokeWidth = 1.6 }: IconProps) {
  const d = PATHS[name as IconName] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/** 節點型別的形狀記號（圖例用，與 3D 形狀語義一致）。 */
export function KindGlyph({ kind, color, size = 13 }: { kind: string; color: string; size?: number }) {
  const s = size;
  const common = { stroke: color, strokeWidth: 1.4, fill: 'none' } as const;
  switch (kind) {
    case 'person':
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.4" {...common} /></svg>;
    case 'organization':
      return <svg width={s} height={s} viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.4" {...common} /></svg>;
    case 'country':
      return <svg width={s} height={s} viewBox="0 0 16 16"><polygon points="8,2.4 13.6,5.6 13.6,10.4 8,13.6 2.4,10.4 2.4,5.6" {...common} /></svg>;
    case 'place':
      return <svg width={s} height={s} viewBox="0 0 16 16"><polygon points="8,2.5 13 8 8,13.5 3,8" {...common} /></svg>;
    case 'technology':
      return <svg width={s} height={s} viewBox="0 0 16 16"><polygon points="8,2.5 13.4,12.6 2.6,12.6" {...common} /></svg>;
    case 'resource':
      return <svg width={s} height={s} viewBox="0 0 16 16"><polygon points="8,2 12.5,4.8 12.5,11.2 8,14 3.5,11.2 3.5,4.8" {...common} /></svg>;
    case 'event':
      return <svg width={s} height={s} viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="6" ry="3.2" {...common} /><ellipse cx="8" cy="8" rx="3.2" ry="6" {...common} /></svg>;
    case 'claim':
      return <svg width={s} height={s} viewBox="0 0 16 16"><polygon points="8,2 14,8 8,14 2,8" {...common} /></svg>;
    case 'evidence':
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" {...common} /><circle cx="8" cy="8" r="6" strokeDasharray="2 2" {...common} /></svg>;
    case 'source':
      return <svg width={s} height={s} viewBox="0 0 16 16"><path d="M4 2.5h5.5L13 6v7.5H4z M9.5 2.5V6H13" {...common} /></svg>;
    case 'knowledge':
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" {...common} /><circle cx="8" cy="8" r="2.4" {...common} /></svg>;
    case 'hypothesis':
    case 'scenario':
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" strokeDasharray="2.4 2.2" {...common} /></svg>;
    case 'analysis':
      return <svg width={s} height={s} viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" strokeDasharray="2 2" {...common} /></svg>;
    default:
      return <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.6" {...common} /></svg>;
  }
}
