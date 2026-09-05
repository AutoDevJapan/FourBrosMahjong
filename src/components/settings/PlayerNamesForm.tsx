"use client";

/**
 * 対局者名の設定フォーム(issue #291 / スペック6 6.2)。
 *
 * 四人回しの4人(p0-p3)の表示名を入力し `localStorage` に保存する。
 * 保存値は次の対局開始時に `createGame({ names })` へ渡され、盤面・結果画面・読み上げに反映される
 * (進行中の半荘の名前は途中で変わらない。半荘の名前は開始時にジャーナルへ固定される)。
 *
 * Server/Client 境界(スペック6 6.6): ブラウザAPI(`localStorage`)を触るのは本葉コンポーネントだけで、
 * `/settings` ページ自体は Server Component のまま保つ。
 *
 * 保存値は `useSyncExternalStore` で購読し(`ThemeToggle` と同じ方式)、入力途中の下書きだけを
 * ローカル state で上書きする。サーバー/初回クライアント描画はともに既定名なのでハイドレーション
 * 不一致が起きず、`useEffect` での setState も不要になる。
 *
 * アクセシビリティ(スペック5 5.2):
 * - `fieldset`/`legend` でグループ化し、各入力はネイティブ `<label for>` で関連付ける。
 * - フォーカスリングは除去せず `focus-visible` で可視化する。
 * - 保存結果は色に依存しないテキストとして `aria-live="polite"` で通知する。
 * - 空欄は既定名へフォールバックする旨を `aria-describedby` の説明文で事前に伝える。
 */

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { localStorageOrNull } from "@/components/common/browserStorage";
import CharacterPortrait, {
  characterAccentStyle,
} from "@/components/game/CharacterPortrait";
import { CHARACTER_PLAYER_IDS } from "@/domain/game/characters";
import {
  boundPlayerNameInput,
  DEFAULT_NAMES,
  getPlayerNamesSnapshot,
  getServerPlayerNamesSnapshot,
  limitPlayerName,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_NAME_LABELS,
  type PlayerNames,
  resolvePlayerNames,
  savePlayerNames,
  subscribePlayerNames,
} from "./playerNames";

type SaveStatus = { kind: "idle" } | { kind: "saved" } | { kind: "failed" };

export function PlayerNamesForm() {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  // 保存値は `localStorage`(React の外の可変ストア)なので購読して読む。
  // サーバー用スナップショットは既定名なのでハイドレーションが一致し、以後実値へ同期される。
  const saved = useSyncExternalStore(
    subscribePlayerNames,
    getPlayerNamesSnapshot,
    getServerPlayerNamesSnapshot,
  );
  // 入力途中の下書きは保存値への「上書き」として持つ。未編集(`null`)なら保存値をそのまま表示し、
  // 保存直後に `null` へ戻すことでストア側の確定値が改めて反映される。
  const [draft, setDraft] = useState<PlayerNames | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const values = draft ?? saved;
  // IME変換中(未確定)の入力欄。ネイティブの `maxlength` は未確定文字列に適用されず
  // 確定時に初めて効くが、React の `onChange` は未確定入力でも発火する。ここで
  // 切り詰めてしまうと「日本語入力テスト」(確定後8書記素)のように**読みだけが上限を
  // 超える**入力で変換が壊れるため、確定するまでは上限を当てない(#484)。
  // 入力欄ごとの集合を持つことで、変換途中に別の欄へフォーカスが移ったり、
  // 古い欄の compositionend/blur が遅れて届いたりしても、他の欄の上限が外れたままにならない。
  // なお保存時は `resolvePlayerNames` が必ず切り詰めるので、上限超過が永続化されることはない。
  const composingIndices = useRef(new Set<number>());

  const updateAt = (index: number, value: string, isComposing: boolean) => {
    const next = [...values] as unknown as [string, string, string, string];
    next[index] = isComposing
      ? boundPlayerNameInput(value)
      : limitPlayerName(value);
    setDraft(next);
    setStatus({ kind: "idle" });
  };

  /** 確定値を保存し、下書きを破棄してストアの値へ戻す。 */
  const persist = (names: PlayerNames) => {
    const storage = localStorageOrNull();
    const ok = storage !== null && savePlayerNames(storage, names);
    // 保存できなければ入力内容が消えないよう下書きを残す。
    setDraft(ok ? null : names);
    setStatus({ kind: ok ? "saved" : "failed" });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 空欄の既定名フォールバックと文字数上限を保存前に確定する。
    persist(resolvePlayerNames(values));
  };

  const handleReset = () => {
    persist(DEFAULT_NAMES);
  };

  return (
    <form onSubmit={handleSubmit} className="settings-names-form">
      <fieldset className="settings-names-fieldset">
        <legend>四兄弟の名前</legend>
        <p id={hintId} className="settings-form-hint">
          空欄のまま保存すると既定名(
          {DEFAULT_NAMES.join("・")})に戻ります。1人あたり
          {MAX_PLAYER_NAME_LENGTH}
          文字(絵文字や結合文字は見た目の1文字として数えます)までです。同じ名前も使用できます。変更は次に開始する半荘から反映されます。
        </p>

        <div className="settings-name-grid">
          {PLAYER_NAME_LABELS.map((label, index) => {
            const inputId = `${fieldId}-${index}`;
            const playerId = CHARACTER_PLAYER_IDS[index];
            return (
              <div
                key={label}
                data-character-id={playerId}
                style={characterAccentStyle(playerId)}
                className="character-surface settings-name-card"
              >
                <CharacterPortrait playerId={playerId} />
                <div className="settings-name-control">
                  <label
                    htmlFor={inputId}
                    className="character-name settings-name-label"
                  >
                    {label}
                    {index === 0 && (
                      <span className="settings-self-badge">（あなた）</span>
                    )}
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    value={values[index]}
                    autoComplete="off"
                    aria-describedby={hintId}
                    onCompositionStart={() => {
                      composingIndices.current.add(index);
                    }}
                    onCompositionEnd={(event) => {
                      composingIndices.current.delete(index);
                      updateAt(index, event.currentTarget.value, false);
                    }}
                    // `compositionend` を落とす IME(一部の Android)でも、
                    // フォーカスが外れた時点で上限を復帰させる。
                    onBlur={(event) => {
                      if (!composingIndices.current.delete(index)) return;
                      updateAt(index, event.currentTarget.value, false);
                    }}
                    onChange={(event) =>
                      updateAt(
                        index,
                        event.target.value,
                        composingIndices.current.has(index),
                      )
                    }
                    className="settings-name-input"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="settings-form-actions">
        <button type="submit" className="settings-save-button">
          名前を保存
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="settings-reset-button"
        >
          既定名に戻す
        </button>
      </div>

      <p aria-live="polite" className="settings-save-status">
        {status.kind === "saved" && "保存しました。次の半荘から反映されます。"}
        {status.kind === "failed" &&
          "保存できませんでした。ブラウザの設定でデータ保存が制限されている可能性があります。"}
      </p>
    </form>
  );
}
