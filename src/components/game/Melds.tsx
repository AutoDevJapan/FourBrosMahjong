/**
 * 副露(ポン・カン)の表示(スペック6 6.4.2 / スペック4 4.2 `Meld`)。
 *
 * 晒した面子を全員分表示する。暗槓は両端2枚を伏せ、内側2枚のみ開示する慣行に従う
 * (ポン・明槓・加槓は全牌開示)。値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
import type { MeldView } from "./types";
import Tile from "../common/Tile";

export interface MeldsProps {
  melds: readonly MeldView[];
}

const MELD_TYPE_LABEL: Record<MeldView["type"], string> = {
  pon: "ポン",
  kan: "カン",
};

export default function Melds({ melds }: MeldsProps) {
  if (melds.length === 0) return null;
  return (
    <ul aria-label="副露" className="flex flex-wrap gap-1.5">
      {melds.map((meld, mi) => {
        const label = meld.concealed ? "暗槓" : MELD_TYPE_LABEL[meld.type];
        const last = meld.tiles.length - 1;
        return (
          <li
            // 同種の副露が複数あり得るため index を key に含める。
            key={`meld-${meld.type}-${mi}`}
            aria-label={label}
            className="flex gap-0.5"
          >
            {meld.tiles.map((tile, ti) => {
              // 伏せ表示は暗槓(concealed=true の槓子4枚)のみ。慣行に従い両端2枚を伏せる。
              const faceDown = meld.concealed && (ti === 0 || ti === last);
              return (
                <Tile
                  key={`${tile.suit}-${tile.rank}-${ti}`}
                  tile={faceDown ? null : tile}
                  size="river"
                />
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}
