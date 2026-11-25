import type { ViewMode } from '../data/types';
import type { IconName } from '../components/Icon';

export interface ViewDef {
  key: ViewMode;
  label: string;
  hint: string;
  icon: IconName;
  keybind: string;
}

export const VIEWS: ViewDef[] = [
  { key: 'universe', label: '宇宙', hint: '3D 知識宇宙：節點、關係與證據', icon: 'universe', keybind: '1' },
  { key: 'map', label: '地圖', hint: '2.5D 世界地圖：地理角色與不確定性', icon: 'map', keybind: '2' },
  { key: 'timeline', label: '時間軸', hint: '雙時間語義與事件密度', icon: 'timeline', keybind: '3' },
  { key: 'browse', label: '瀏覽', hint: '節點、來源與主張的清單檢視', icon: 'browse', keybind: '4' },
];
