"use client";

import { useMemo, useState } from "react";
import {
  CHARACTER_PROFILES,
  type CharacterPlayerId,
} from "@/domain/game/characters";
import { createGame } from "@/domain/game/engine";
import contract from "../../../documents/fixtures/unity-display-contract.json";
import Discards from "../game/Discards";
import EffectOverlay from "../game/effects/EffectOverlay";
import type { ActiveGameEffect } from "../game/effects/useGameEffects";
import GameBoard from "../game/GameBoard";
import { GameProvider } from "../game/GameProvider";
import Hand from "../game/Hand";
import KitaDisplay from "../game/KitaDisplay";
import PlayerSlot from "../game/PlayerSlot";
import type {
  RiverTileData,
  SeatPosition,
  SeatWind,
  SlotContent,
  TileData,
} from "../game/types";
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
  unityOnlyKinds: "Unity側で新規実装が必要な演出",
  unityOnlyKindsReason: "Unity専用演出とする理由",
};

type EffectPreview = Pick<
  ActiveGameEffect,
  | "kind"
  | "icon"
  | "title"
  | "detail"
  | "announcement"
  | "assertive"
  | "playerId"
>;

/**
 * Web側 `gameEffect` が実際に発火できる演出の見本。キーは `GameEffectKind` と同じ集合で、
 * 表示するボタン列は契約fixtureの `kinds` から導く(勝手な独自リストにしない)。
 */
const EFFECT_PREVIEW_BY_KIND: Readonly<
  Record<ActiveGameEffect["kind"], EffectPreview>
> = {
  discard: {
    kind: "discard",
    icon: "切",
    title: "打牌",
    detail: "粗悪品が五筒を捨てました。",
    announcement: "粗悪品が五筒を捨てました。",
    assertive: false,
    playerId: "p0",
  },
  riichi: {
    kind: "riichi",
    icon: "宣",
    title: "リーチ",
    detail: "竜二がリーチを宣言しました。",
    announcement: "竜二がリーチを宣言しました。",
    assertive: false,
    playerId: "p1",
  },
  pon: {
    kind: "pon",
    icon: "碰",
    title: "ポン",
    detail: "マサキがポンしました。",
    announcement: "マサキがポンしました。",
    assertive: false,
    playerId: "p2",
  },
  kan: {
    kind: "kan",
    icon: "槓",
    title: "カン",
    detail: "糸瓜がカンしました。",
    announcement: "糸瓜がカンしました。",
    assertive: false,
    playerId: "p3",
  },
  tsumo: {
    kind: "tsumo",
    icon: "自",
    title: "ツモ",
    detail: "粗悪品のツモ和了。",
    announcement: "粗悪品のツモ和了。",
    assertive: true,
    playerId: "p0",
  },
  ron: {
    kind: "ron",
    icon: "栄",
    title: "ロン",
    detail: "竜二のロン和了。",
    announcement: "竜二のロン和了。",
    assertive: true,
    playerId: "p1",
  },
  draw: {
    kind: "draw",
    icon: "流",
    title: "流局",
    detail: "九種九牌で流局しました。",
    announcement: "流局。九種九牌で流局しました。",
    assertive: true,
  },
  roundEnd: {
    kind: "roundEnd",
    icon: "局",
    title: "局終了",
    detail: "次の局へ進みます。",
    announcement: "局が終了しました。",
    assertive: true,
  },
};

type MajorEffectAssertions = {
  readonly kinds?: readonly string[];
  readonly unityOnlyKinds?: readonly string[];
};

function majorEffectAssertions(): MajorEffectAssertions {
  const visualCase = contract.visualCases.find(
    (item) => item.id === "major-effects",
  );
  return (visualCase?.assertions ?? {}) as MajorEffectAssertions;
}

function isWebEffectKind(value: string): value is ActiveGameEffect["kind"] {
  return Object.hasOwn(EFFECT_PREVIEW_BY_KIND, value);
}

/** 契約fixtureが宣言するWeb演出の順序どおりに見本を並べる。 */
const WEB_EFFECT_PREVIEWS: readonly EffectPreview[] = (
  majorEffectAssertions().kinds ?? []
)
  .filter(isWebEffectKind)
  .map((kind) => EFFECT_PREVIEW_BY_KIND[kind]);

/** Web側に演出実装が無く、Unity表示クライアントで新規実装が要る演出。 */
const UNITY_ONLY_EFFECT_KINDS: readonly string[] =
  majorEffectAssertions().unityOnlyKinds ?? [];

const UNITY_ONLY_EFFECT_COPY: Record<
  string,
  { readonly title: string; readonly description: string }
> = {
  kita: {
    title: "北抜き(ガリ)",
    description:
      "抜いた北の枚数は `KitaDisplay` が常時表示するが、抜いた瞬間の演出はWeb側に無い。Unity側は表示契約のeffect種別 kita を受けて新規に演出を実装する。",
  },
};

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

/**
 * 席ローテーション表示の河サンプル。12状態を1画面で見比べるため短くし、
 * リーチ宣言牌の横置きだけは席方向と一緒に確認できるよう残す。
 */
const ROTATION_DISCARDS: readonly RiverTileData[] = [
  { suit: "man", rank: 1 },
  { suit: "sou", rank: 5, isRed: true, isRiichi: true },
  { suit: "honor", rank: 4 },
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

/**
 * 4物理スロット → プレイヤーIDの固定割り当て。契約fixtureの `slotShape` をSSOTにして、
 * 席が回っても物理位置(自家/上家/対面/下家)は動かないことを見た目で確かめられるようにする。
 */
const PHYSICAL_PLAYERS: Readonly<Record<SeatPosition, CharacterPlayerId>> =
  (() => {
    const shape = contract.visualCases.find(
      (item) => item.id === "bench-warmers",
    )?.assertions as
      | { slotShape?: Record<string, { playerId: string; points: number }> }
      | undefined;
    const slotShape = shape?.slotShape;
    const pick = (position: SeatPosition): CharacterPlayerId =>
      (slotShape?.[position]?.playerId ?? "p0") as CharacterPlayerId;
    return {
      self: pick("self"),
      left: pick("left"),
      across: pick("across"),
      right: pick("right"),
    };
  })();

const FIXTURE_BASE_POINTS = 35000;

type FixtureSeatMap = Readonly<Record<string, string>>;

interface RotationDisplayState {
  readonly key: string;
  readonly caseName: string;
  /** `east-4-to-south-1` は席回転と局替わりの双方にあるため、群を分けて一意にする。 */
  readonly group: "rotation" | "progression";
  readonly phase: "before" | "after";
  readonly heading: string;
  readonly roundLabel: string;
  readonly seats: FixtureSeatMap;
  readonly points: Readonly<Record<string, number>> | null;
}

function roundLabelOf(round: {
  readonly wind: string;
  readonly handNumber: number;
  readonly honba: number;
}): string {
  const wind = round.wind === "south" ? "南" : "東";
  return `${wind}${round.handNumber}局 ${round.honba}本場`;
}

/**
 * fixtureの4回転(前後)と局替わり2件(前後)= 12状態。席割り・持ち点はfixtureの値をそのまま読み、
 * ここで親流れや点数を計算しない(ルールSSOTはdomain/サーバー側)。
 */
const ROTATION_DISPLAY_STATES: readonly RotationDisplayState[] = [
  ...contract.rotationCases.flatMap((rotationCase): RotationDisplayState[] => [
    {
      key: `rotation-${rotationCase.name}-before`,
      caseName: rotationCase.name,
      group: "rotation",
      phase: "before",
      heading: `${rotationCase.name} / 適用前`,
      roundLabel: "席回転fixture",
      seats: rotationCase.before,
      points: null,
    },
    {
      key: `rotation-${rotationCase.name}-after`,
      caseName: rotationCase.name,
      group: "rotation",
      phase: "after",
      heading: `${rotationCase.name} / 適用後`,
      roundLabel: "席回転fixture",
      seats: rotationCase.after,
      points: null,
    },
  ]),
  ...contract.progressionCases.flatMap(
    (progression): RotationDisplayState[] => [
      {
        key: `progression-${progression.name}-before`,
        caseName: progression.name,
        group: "progression",
        phase: "before",
        heading: `${progression.name} / 適用前`,
        roundLabel: roundLabelOf(progression.beforeRound),
        seats: progression.beforeSeats,
        points: progression.beforePoints,
      },
      {
        key: `progression-${progression.name}-after`,
        caseName: progression.name,
        group: "progression",
        phase: "after",
        heading: `${progression.name} / 適用後`,
        roundLabel: roundLabelOf(progression.afterRound),
        seats: progression.afterSeats,
        points: progression.afterPoints,
      },
    ],
  ),
];

function seatWindOf(
  seats: FixtureSeatMap,
  playerId: CharacterPlayerId,
): SeatWind | null {
  for (const wind of ["east", "south", "west"] as const) {
    if (seats[wind] === playerId) return wind;
  }
  return null;
}

function rotationSlotContent(
  state: RotationDisplayState,
  playerId: CharacterPlayerId,
): SlotContent {
  const name = CHARACTER_PROFILES[playerId].defaultName;
  const points = state.points?.[playerId] ?? FIXTURE_BASE_POINTS;
  const seatWind = seatWindOf(state.seats, playerId);
  if (seatWind === null) {
    return { kind: "bench", player: { playerId, name, points } };
  }
  return {
    kind: "seated",
    player: {
      playerId,
      name,
      points,
      seatWind,
      status: { isDealer: seatWind === "east" },
      // 北抜き(ガリ)の公開枚数は席が回っても表示され続けることを見せる。
      kitaCount: seatWind === "east" ? 1 : 0,
      discards: ROTATION_DISCARDS,
      handCount: 13,
    },
  };
}

function RotationBoard({ state }: { readonly state: RotationDisplayState }) {
  return (
    <article
      className="unity-display-rotation-board"
      data-testid={`unity-display-rotation-${state.key}`}
      data-rotation-case={state.caseName}
      data-rotation-group={state.group}
      data-rotation-phase={state.phase}
    >
      <header className="unity-display-rotation-board-heading">
        <h4>{state.heading}</h4>
        <span className="unity-display-rotation-round">{state.roundLabel}</span>
      </header>
      <div className="unity-display-rotation-cross" data-board-layout="cross">
        {(["across", "left", "right", "self"] as const).map((position) => (
          <div
            key={position}
            className={`unity-display-rotation-cell unity-display-rotation-cell--${position}`}
            data-slot-position={position}
          >
            <PlayerSlot
              position={position}
              content={rotationSlotContent(state, PHYSICAL_PLAYERS[position])}
              compact
            />
          </div>
        ))}
      </div>
    </article>
  );
}

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
  const selected = WEB_EFFECT_PREVIEWS[effectIndex] ?? WEB_EFFECT_PREVIEWS[0];
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
        {WEB_EFFECT_PREVIEWS.map((preview, index) => (
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
      <div
        className="unity-display-effect-gap"
        data-testid="unity-display-unity-only-effects"
      >
        <p className="unity-display-effect-gap-title">
          Web側に演出実装が無く、Unityで新規実装が必要な演出
        </p>
        <ul>
          {UNITY_ONLY_EFFECT_KINDS.map((kind) => {
            const copy = UNITY_ONLY_EFFECT_COPY[kind];
            return (
              <li key={kind} data-unity-only-effect={kind}>
                <span className="unity-display-effect-gap-kind">
                  {copy?.title ?? kind}
                </span>
                <span className="unity-display-effect-gap-sample">
                  <KitaDisplay count={1} />
                </span>
                <span>
                  {copy?.description ??
                    "Web側に対応する演出が無いため、見本を表示できない。"}
                </span>
              </li>
            );
          })}
        </ul>
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

          <div
            className="unity-display-rotation-grid"
            data-testid="unity-display-rotation-boards"
            role="group"
            aria-label="席ローテーションと局替わりの表示"
          >
            {ROTATION_DISPLAY_STATES.map((state) => (
              <RotationBoard key={state.key} state={state} />
            ))}
          </div>
          <p className="unity-display-note">
            4物理スロット(自家=下 / 上家=左 / 対面=上 / 下家=右)は
            <code>slotShape</code>
            に固定し、席風・親・抜け番・持ち点だけが入力どおり入れ替わる。
            全12状態でスロットの欠落・重複・崩れが無いことをブラウザ上で確認できる。
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
