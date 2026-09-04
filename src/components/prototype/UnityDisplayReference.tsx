"use client";

import { useMemo, useState } from "react";
import { createGame } from "@/domain/game/engine";
import contract from "../../../documents/fixtures/unity-display-contract.json";
import Discards from "../game/Discards";
import EffectOverlay from "../game/effects/EffectOverlay";
import type { ActiveGameEffect } from "../game/effects/useGameEffects";
import GameBoard from "../game/GameBoard";
import { GameProvider } from "../game/GameProvider";
import Hand from "../game/Hand";
import PlayerSlot from "../game/PlayerSlot";
import type { RiverTileData, SlotContent, TileData } from "../game/types";
import { DesignLinkButton, DesignPageShell } from "../layout/DesignSurface";

const FIXED_SEED = 828;

const VISUAL_CASE_COPY: Record<
  string,
  { readonly title: string; readonly description: string }
> = {
  "river-wrap-and-riichi": {
    title: "河とリーチ宣言牌",
    description: "河の順序・折り返し・リーチ宣言牌の横置きを確認する。",
  },
  "hand-deal-draw-replacement-meld": {
    title: "手牌の遷移",
    description: "配牌・ツモ・置換・鳴き後の整列を確認する。",
  },
  "major-effects": {
    title: "主要な演出",
    description: "コミット済み表示状態から導く演出の見え方を確認する。",
  },
  "bench-warmers": {
    title: "抜け番と4物理スロット",
    description: "3人着席と1人抜け番を4方向の枠内で確認する。",
  },
};

const ASSERTION_LABEL: Record<string, string> = {
  directionalSlot: "方向スロット",
  gridWrap: "河の折り返し",
  riichiTileIsSideways: "リーチ牌の横置き",
  discardOrderIsPreserved: "捨て順の保持",
  transitionKinds: "遷移種別",
  drawEntranceDurationMs: "ツモ入場時間",
  dealDelayIsDeterministic: "配牌遅延の決定性",
  tileOrderIsNotUsedForDomainDecisions: "牌順をルール判定に利用しない",
  kinds: "演出種別",
  effectIsDerivedFromCommittedView: "確定表示状態から演出を導出",
  resolutionIsAssertive: "決着演出のassertive通知",
  slotCount: "物理スロット数",
  seatedCount: "着席数",
  benchCount: "抜け番数",
  benchHasNoSeatWind: "抜け番に席風を付けない",
  pointsRemainWithPlayer: "持ち点をプレイヤーに保持",
};

const EFFECT_PREVIEWS: readonly Pick<
  ActiveGameEffect,
  | "kind"
  | "icon"
  | "title"
  | "detail"
  | "announcement"
  | "assertive"
  | "playerId"
>[] = [
  {
    kind: "discard",
    icon: "切",
    title: "打牌",
    detail: "粗悪品が五筒を捨てました。",
    announcement: "粗悪品が五筒を捨てました。",
    assertive: false,
    playerId: "p0",
  },
  {
    kind: "riichi",
    icon: "宣",
    title: "リーチ",
    detail: "竜二がリーチを宣言しました。",
    announcement: "竜二がリーチを宣言しました。",
    assertive: false,
    playerId: "p1",
  },
  {
    kind: "pon",
    icon: "碰",
    title: "ポン",
    detail: "マサキがポンしました。",
    announcement: "マサキがポンしました。",
    assertive: false,
    playerId: "p2",
  },
  {
    kind: "kan",
    icon: "槓",
    title: "カン",
    detail: "糸瓜がカンしました。",
    announcement: "糸瓜がカンしました。",
    assertive: false,
    playerId: "p3",
  },
  {
    kind: "tsumo",
    icon: "自",
    title: "ツモ",
    detail: "粗悪品のツモ和了。",
    announcement: "粗悪品のツモ和了。",
    assertive: true,
    playerId: "p0",
  },
  {
    kind: "ron",
    icon: "栄",
    title: "ロン",
    detail: "竜二のロン和了。",
    announcement: "竜二のロン和了。",
    assertive: true,
    playerId: "p1",
  },
  {
    kind: "draw",
    icon: "流",
    title: "流局",
    detail: "九種九牌で流局しました。",
    announcement: "流局。九種九牌で流局しました。",
    assertive: true,
  },
  {
    kind: "roundEnd",
    icon: "局",
    title: "局終了",
    detail: "次の局へ進みます。",
    announcement: "局が終了しました。",
    assertive: true,
  },
];

const SAMPLE_DISCARDS: readonly RiverTileData[] = [
  { suit: "man", rank: 1 },
  { suit: "pin", rank: 5, isRed: true },
  { suit: "sou", rank: 9 },
  { suit: "honor", rank: 1 },
  { suit: "man", rank: 9 },
  { suit: "pin", rank: 1 },
  { suit: "sou", rank: 5, isRed: true, isRiichi: true },
  { suit: "honor", rank: 4 },
  { suit: "man", rank: 2 },
  { suit: "pin", rank: 8 },
  { suit: "sou", rank: 2 },
  { suit: "honor", rank: 7 },
];

const SAMPLE_HAND: readonly TileData[] = [
  { suit: "man", rank: 1 },
  { suit: "man", rank: 2 },
  { suit: "man", rank: 3 },
  { suit: "pin", rank: 2 },
  { suit: "pin", rank: 3 },
  { suit: "pin", rank: 4 },
  { suit: "pin", rank: 5, isRed: true },
  { suit: "sou", rank: 4 },
  { suit: "sou", rank: 5, isRed: true },
  { suit: "sou", rank: 6 },
  { suit: "honor", rank: 1 },
  { suit: "honor", rank: 1 },
  { suit: "honor", rank: 5 },
  { suit: "honor", rank: 7 },
];

const SAMPLE_BENCH: SlotContent = {
  kind: "bench",
  player: {
    playerId: "p3",
    name: "糸瓜",
    points: 35000,
  },
};

function formatAssertionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(formatAssertionValue).join(", ")}]`;
  }
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, nested]) => `${key}=${formatAssertionValue(nested)}`)
      .join(", ")}}`;
  }
  return String(value);
}

function formatAssertions(assertions: Record<string, unknown>): string[] {
  return Object.entries(assertions).map(
    ([key, value]) =>
      `${ASSERTION_LABEL[key] ?? key}: ${formatAssertionValue(value)}`,
  );
}

function formatRotation(value: Record<string, string>): string {
  return ["east", "south", "west", "bench"]
    .map((slot) => `${slot}=${value[slot] ?? "—"}`)
    .join(" / ");
}

function VisualCasePreview({ caseId }: { readonly caseId: string }) {
  if (caseId === "river-wrap-and-riichi") {
    return (
      <div className="unity-display-case-preview unity-display-river-preview">
        <Discards tiles={SAMPLE_DISCARDS} />
      </div>
    );
  }

  if (caseId === "hand-deal-draw-replacement-meld") {
    return (
      <div className="unity-display-case-preview unity-display-hand-preview">
        <Hand tiles={SAMPLE_HAND} readOnly label="リファレンス手牌" />
        <p className="unity-display-preview-caption">
          配牌 / ツモ / 置換 / 鳴き後整列
        </p>
      </div>
    );
  }

  if (caseId === "major-effects") {
    return <EffectCasePreview />;
  }

  return (
    <div className="unity-display-case-preview unity-display-bench-preview">
      <div data-testid="unity-display-bench-preview" data-slot-position="left">
        <PlayerSlot position="left" content={SAMPLE_BENCH} />
      </div>
    </div>
  );
}

function EffectCasePreview() {
  const [effectIndex, setEffectIndex] = useState(0);
  const selected = EFFECT_PREVIEWS[effectIndex] ?? EFFECT_PREVIEWS[0];
  if (!selected) return null;

  const effect: ActiveGameEffect = {
    ...selected,
    eventId: effectIndex + 1,
    eventKey: `unity-reference-effect-${selected.kind}`,
    scopeKey: "unity-reference-east-1-playing",
  };

  return (
    <div className="unity-display-case-preview unity-display-effect-preview">
      <div
        className="unity-display-effect-buttons"
        role="group"
        aria-label="演出プレビューの種類"
      >
        {EFFECT_PREVIEWS.map((preview, index) => (
          <button
            key={preview.kind}
            type="button"
            className="unity-display-effect-button"
            data-effect-preview={preview.kind}
            aria-pressed={index === effectIndex}
            onClick={() => setEffectIndex(index)}
          >
            {preview.title}
          </button>
        ))}
      </div>
      <div className="unity-display-effect-stage">
        <EffectOverlay effect={effect} />
        <p className="unity-display-preview-caption">
          選択中: {selected.title}（確定表示状態から導出する演出の見本）
        </p>
      </div>
    </div>
  );
}

export interface UnityDisplayReferenceProps {
  readonly fontVariableClassName?: string;
}

/**
 * #818/#828のUnity表示契約を、Unity導入なしで確認するためのブラウザ・リファレンス。
 *
 * ここで使う盤面は本番対局の表示コンポーネントと実エンジンを固定seedで再利用する。
 * ルールや席割りをプロトタイプ専用に複製せず、後のUnity表示クライアントが比較する
 * 「期待される表示」と、Web版で実際に動く表示を同じ画面へ並べる。
 */
export default function UnityDisplayReference({
  fontVariableClassName = "",
}: UnityDisplayReferenceProps) {
  const initialGame = useMemo(() => createGame({ seed: FIXED_SEED }), []);

  return (
    <DesignPageShell
      className={`game-page unity-display-page ${fontVariableClassName}`}
    >
      <main
        className="unity-display-main"
        data-contract-schema={contract.schema}
        data-contract-version={contract.schemaVersion}
      >
        <header className="unity-display-header">
          <div className="unity-display-heading-copy">
            <p className="unity-display-kicker">
              #818 / #828・表示契約リファレンス
            </p>
            <h1 className="unity-display-title">Unity表示リファレンス</h1>
            <p className="unity-display-lede">
              Unity導入前に、固定fixtureを使って対局画面の表示と演出を確認するためのページです。
            </p>
          </div>
          <DesignLinkButton href="/" className="unity-display-back-link">
            <span aria-hidden="true">←</span>
            ロビーへ戻る
          </DesignLinkButton>
        </header>

        <section
          className="unity-display-status"
          aria-labelledby="unity-display-status-title"
          data-testid="unity-reference-boundary"
        >
          <h2 id="unity-display-status-title">検証の位置づけ</h2>
          <p>
            これはUnity Runtimeではなく、Vercel上で動くWeb版のリファレンスです。
            Unity側はこの表示契約を入力として利用し、ルール計算はWeb/Domain側に残します。
          </p>
          <dl className="unity-display-facts">
            <div>
              <dt>入力</dt>
              <dd>
                <code>unity-display-contract.json</code>
              </dd>
            </div>
            <div>
              <dt>固定seed</dt>
              <dd>{FIXED_SEED}</dd>
            </div>
            <div>
              <dt>schema</dt>
              <dd>
                {contract.schemaVersion} / snapshot{" "}
                {contract.source.snapshotVersion}
              </dd>
            </div>
            <div>
              <dt>通信</dt>
              <dd>認証・WebSocketなし</dd>
            </div>
          </dl>
        </section>

        <div className="unity-display-columns">
          <section
            className="design-panel unity-display-board-panel"
            aria-labelledby="unity-display-board-title"
          >
            <div className="unity-display-section-heading">
              <div>
                <p className="unity-display-section-kicker">実際のWeb表示</p>
                <h2 id="unity-display-board-title">固定対局盤面</h2>
              </div>
              <span className="unity-display-seed-badge">
                seed={FIXED_SEED}
              </span>
            </div>
            <div
              className="unity-display-board-host"
              data-testid="unity-reference-board"
            >
              <GameProvider initialGame={initialGame}>
                <GameBoard />
              </GameProvider>
            </div>
          </section>

          <aside
            className="design-panel unity-display-contract-panel"
            aria-labelledby="unity-display-contract-title"
          >
            <div className="unity-display-section-heading">
              <div>
                <p className="unity-display-section-kicker">fixture schema</p>
                <h2 id="unity-display-contract-title">表示契約チェック</h2>
              </div>
              <span className="unity-display-contract-badge">
                v{contract.schemaVersion}
              </span>
            </div>
            <ol className="unity-display-case-list">
              {contract.visualCases.map((visualCase) => {
                const copy = VISUAL_CASE_COPY[visualCase.id];
                return (
                  <li
                    key={visualCase.id}
                    className="unity-display-case-item"
                    data-testid={`unity-display-case-${visualCase.id}`}
                    data-source-component={visualCase.sourceComponent}
                  >
                    <div className="unity-display-case-heading">
                      <span className="unity-display-case-number">
                        {visualCase.id}
                      </span>
                      <span className="unity-display-case-status">
                        契約確認
                      </span>
                    </div>
                    <h3>{copy?.title ?? visualCase.id}</h3>
                    <p>{copy?.description ?? "表示契約の確認ケース。"}</p>
                    <code className="unity-display-source-component">
                      {visualCase.sourceComponent}
                    </code>
                    <ul className="unity-display-assertion-list">
                      {formatAssertions(visualCase.assertions).map(
                        (assertion) => (
                          <li key={assertion}>{assertion}</li>
                        ),
                      )}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>

        <section
          className="design-panel unity-display-visual-panel"
          aria-labelledby="unity-display-visual-title"
        >
          <div className="unity-display-section-heading">
            <div>
              <p className="unity-display-section-kicker">component samples</p>
              <h2 id="unity-display-visual-title">表示ケースの見本</h2>
            </div>
            <span className="unity-display-reference-badge">Web reference</span>
          </div>
          <div className="unity-display-visual-grid">
            {contract.visualCases.map((visualCase) => {
              const copy = VISUAL_CASE_COPY[visualCase.id];
              return (
                <article
                  key={visualCase.id}
                  className="unity-display-visual-case"
                  data-testid={`unity-display-preview-${visualCase.id}`}
                >
                  <h3>{copy?.title ?? visualCase.id}</h3>
                  <VisualCasePreview caseId={visualCase.id} />
                </article>
              );
            })}
          </div>
        </section>

        <section
          className="design-panel unity-display-rotation-panel"
          aria-labelledby="unity-display-rotation-title"
        >
          <div className="unity-display-section-heading">
            <div>
              <p className="unity-display-section-kicker">rotation fixture</p>
              <h2 id="unity-display-rotation-title">4人回しの固定シナリオ</h2>
            </div>
            <span className="unity-display-reference-badge">4 cases</span>
          </div>
          <div className="unity-display-table-wrap">
            <table
              className="unity-display-rotation-table"
              aria-label="親流れの席回転"
            >
              <caption className="sr-only">親流れ時の席と抜け番の回転</caption>
              <thead>
                <tr>
                  <th scope="col">ケース</th>
                  <th scope="col">適用前</th>
                  <th scope="col">適用後</th>
                </tr>
              </thead>
              <tbody>
                {contract.rotationCases.map((rotationCase) => (
                  <tr key={rotationCase.name}>
                    <th scope="row">{rotationCase.name}</th>
                    <td>{formatRotation(rotationCase.before)}</td>
                    <td>{formatRotation(rotationCase.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="unity-display-note">
            連荘は席を回さず本場だけを進め、東4→南1でも持ち点はプレイヤーに保持する。
          </p>
        </section>

        <section
          className="unity-display-boundary-panel"
          aria-labelledby="unity-display-boundary-title"
        >
          <h2 id="unity-display-boundary-title">Unityへ持ち込まない責務</h2>
          <ul>
            {contract.negativeCases.map((negativeCase) => (
              <li key={negativeCase}>{negativeCase}</li>
            ))}
          </ul>
          <p>
            Unity Editor、Unity
            WebGL、実機性能、アセット権利の確認は後続Issueで扱う。
          </p>
        </section>
      </main>
    </DesignPageShell>
  );
}
