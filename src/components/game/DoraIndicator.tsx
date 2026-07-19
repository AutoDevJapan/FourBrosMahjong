/**
 * ドラ表示(スペック6 6.4.2 `DoraIndicator`)。
 *
 * 表ドラ表示牌(1〜3枚)を開示し、裏ドラはリーチ和了時のみ開示するため対局中は
 * 枚数ぶん伏せて表示する。ドラ枚数はサイコロ出目由来だが、UI は与えられた表示牌を描くだけで
 * 出目→枚数の決定ロジックは持たない(スペック6 6.8)。`Tile` を再利用する表示コンポーネント。
 *
 * スペック5 5.2.1 準拠(色・位置のみに依存しない情報伝達 / #261):
 * 表ドラと裏ドラは並び順ではなく**別グループ**として描く。各グループは可視ラベル
 * (「表」「裏」)と仕切りで視覚的に区別でき、SR にはグループ名
 * (`aria-label="表ドラ表示牌"` / `aria-label="裏ドラ表示牌"`)で伝わる。
 * `role="list"` は冗長に見えるが明示する — Tailwind preflight の `list-style: none` により
 * Safari が `<ul>` の list セマンティクスを除去し、VoiceOver がグループ名ごと読まなくなる
 * 既知挙動への標準的な対処。開示注記「裏ドラ開示」は `aria-describedby` で裏グループへ関連付ける。
 * ラベル文言は `WinDetails` の翻数内訳(「表ドラ」「裏ドラ」)と同じ語彙に揃え、
 * 開示された裏ドラを翻数の検算と突き合わせられるようにする。
 *
 * 前提とする不変条件: 裏ドラ表示牌は表ドラ表示牌と同数(`doraSet.ts` / スペック2 2.2)。
 * `uraIndicators`(開示時)と `uraIndicatorCount`(伏せ枚数)が食い違う入力は正規の
 * `gameView` 写像からは生成されず、開示配列を優先して描く。
 */
import { useId } from "react";
import type { DoraData } from "./types";
import Tile from "../common/Tile";

export interface DoraIndicatorProps {
  dora: DoraData;
}

/** グループの可視ラベル(「表」「裏」)。名称は `<ul>` の aria-label が担うため装飾扱い。 */
function GroupCaption({ text }: { text: string }) {
  return (
    <span
      aria-hidden="true"
      className="text-[0.65rem] leading-none text-tile-face opacity-80"
    >
      {text}
    </span>
  );
}

export default function DoraIndicator({ dora }: DoraIndicatorProps) {
  const ura = dora.uraIndicators ?? [];
  const uraCount = Math.max(0, Math.floor(dora.uraIndicatorCount ?? 0));
  const uraRevealed = ura.length > 0;
  const showOmoteGroup = dora.indicators.length > 0;
  const showUraGroup = uraRevealed || uraCount > 0;
  // 開示注記を裏グループへ SR 上でも関連付ける(aria-describedby)。同一画面に本コンポーネントが
  // 複数レイアウト分描かれても id が衝突しないよう useId で一意化する。
  const revealedNoteId = useId();

  return (
    <section aria-label="ドラ表示" className="flex flex-col items-center gap-1">
      <h2 className="text-xs font-semibold text-tile-face opacity-90">
        ドラ表示
      </h2>
      <div className="flex items-stretch gap-1.5">
        {showOmoteGroup ? (
          <div className="flex flex-col items-center gap-0.5">
            <ul role="list" aria-label="表ドラ表示牌" className="flex gap-0.5">
              {dora.indicators.map((tile, i) => (
                <li key={`${tile.suit}-${tile.rank}-${i}`}>
                  <Tile tile={tile} size="dora" />
                </li>
              ))}
            </ul>
            <GroupCaption text="表" />
          </div>
        ) : null}
        {showOmoteGroup && showUraGroup ? (
          // 表/裏の仕切り(視覚)。意味は各グループの aria-label が担う。
          <span
            aria-hidden="true"
            className="w-px self-stretch bg-tile-face opacity-40"
          />
        ) : null}
        {showUraGroup ? (
          <div className="flex flex-col items-center gap-0.5">
            <ul
              role="list"
              aria-label="裏ドラ表示牌"
              aria-describedby={uraRevealed ? revealedNoteId : undefined}
              className="flex gap-0.5"
            >
              {uraRevealed
                ? // リーチ和了時のみ裏ドラを開示する。
                  ura.map((tile, i) => (
                    <li key={`ura-open-${tile.suit}-${tile.rank}-${i}`}>
                      <Tile tile={tile} size="dora" />
                    </li>
                  ))
                : Array.from({ length: uraCount }, (_, i) => (
                    // 裏ドラは対局中は伏せる(リーチ和了時に開示)。
                    <li key={`ura-${i}`}>
                      <Tile tile={null} size="dora" />
                    </li>
                  ))}
            </ul>
            <GroupCaption text="裏" />
          </div>
        ) : null}
      </div>
      {uraRevealed ? (
        <p
          id={revealedNoteId}
          className="text-[0.65rem] text-tile-face opacity-80"
        >
          裏ドラ開示
        </p>
      ) : null}
    </section>
  );
}
