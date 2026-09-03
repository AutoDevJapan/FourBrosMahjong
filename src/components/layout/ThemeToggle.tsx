"use client";

/**
 * ダークモード手動切替トグル(スペック5 5.4.1)。
 *
 * - OS 設定を初期値として尊重し(`prefers-color-scheme`)、ユーザーの明示選択は
 *   `localStorage` に永続化して OS 設定より優先する。
 * - 選択肢は「システム(OS 追従)/ ライト / ダーク」の3値。「システム」は
 *   `data-theme` 属性を外して `prefers-color-scheme` に委譲する。
 * - `matchMedia` の変更に追従し、システム追従時の実効テーマ表示を更新する。
 * - 適用は `<html data-theme>` 属性方式(スペック5 5.4.1 の決定)。
 *
 * ハイドレーション不一致・FOUC 回避:
 * - 初期テーマの DOM 反映は `layout.tsx` のインラインスクリプトが担う(FOUC 回避)。
 * - 本コンポーネントは `localStorage` / `matchMedia` という「外部ストア」を
 *   `useSyncExternalStore` で購読する。サーバー用スナップショットは常に "system"
 *   を返すためサーバー/初回クライアント描画が一致し、ハイドレーション後に
 *   実値へ同期される(setState-in-effect を避けた React 標準の手法)。
 *
 * アクセシビリティ(スペック5 5.2): ネイティブ `<input type="radio">` の radiogroup で
 * キーボード操作(Tab 到達 + 矢印キー移動)・フォーカス可視・選択状態の aria 通知を
 * 標準機能で満たす。実効テーマは `aria-live` で色に依存しないテキストとして通知する。
 */

import { useCallback, useSyncExternalStore } from "react";

/** テーマの選択状態。"system" は OS 設定に追従(=`data-theme` 未設定)。 */
type ThemePreference = "system" | "light" | "dark";

/** `localStorage` の保存キー。`layout.tsx` のインラインスクリプトと一致させること。 */
const STORAGE_KEY = "theme";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "システム設定に従う" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

const EFFECTIVE_LABEL: Record<"light" | "dark", string> = {
  light: "ライト",
  dark: "ダーク",
};

type ThemeSnapshot = {
  preference: ThemePreference;
  systemPrefersDark: boolean;
};

/** サーバー描画・ハイドレーション時の固定スナップショット(未選択=OS 追従)。 */
const SERVER_SNAPSHOT: ThemeSnapshot = {
  preference: "system",
  systemPrefersDark: false,
};

const subscribers = new Set<() => void>();
// `getSnapshot` の参照安定性を保つためのキャッシュ(値が同一なら同じ参照を返す)。
let cachedSnapshot: ThemeSnapshot | null = null;
// localStorage が利用できないタブでも、現在のセッション中は選択と実テーマを
// 一致させる。永続化に成功した時点、または別タブの storage 通知で破棄する。
let volatilePreference: ThemePreference | null = null;

/** 現在タブの揮発設定を優先し、なければ永続値を読む。 */
function readStoredPreference(): ThemePreference {
  // 保存に失敗して古い永続値が残っていても、現在タブの選択を維持する。
  if (volatilePreference !== null) {
    return volatilePreference;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // localStorage 不可(プライベートモード等)は system 扱いにフォールバック。
  }
  return volatilePreference ?? "system";
}

function getClientSnapshot(): ThemeSnapshot {
  const preference = readStoredPreference();
  const systemPrefersDark = window.matchMedia(MEDIA_QUERY).matches;
  if (
    cachedSnapshot &&
    cachedSnapshot.preference === preference &&
    cachedSnapshot.systemPrefersDark === systemPrefersDark
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = { preference, systemPrefersDark };
  return cachedSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

/** 選択に応じて `<html data-theme>` を設定/除去する(DOM 反映のみ)。 */
function writeThemeToDom(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

/**
 * OS 設定変更(`matchMedia`)と別タブでの保存変更(`storage`)を購読する。
 * 別タブでの変更はこのタブの DOM にも反映し、制御表示と実効テーマを一致させる。
 */
function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  const media = window.matchMedia(MEDIA_QUERY);
  const onMediaChange = () => {
    cachedSnapshot = null;
    callback();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      volatilePreference = null;
      // 別タブでの選択をこのタブの DOM へ同期(localStorage は書き換えない)。
      writeThemeToDom(readStoredPreference());
      cachedSnapshot = null;
      callback();
    }
  };
  media.addEventListener("change", onMediaChange);
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(callback);
    media.removeEventListener("change", onMediaChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 選択を `<html data-theme>` と `localStorage` に反映し、購読者へ通知する。 */
function applyPreference(preference: ThemePreference): void {
  writeThemeToDom(preference);
  try {
    if (preference === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
    volatilePreference = null;
  } catch {
    // 保存不可でもこのタブ内の選択を保持し、DOM・radio・状態文言を一致させる。
    volatilePreference = preference;
  }
  cachedSnapshot = null;
  for (const callback of subscribers) {
    callback();
  }
}

/**
 * 現在の保存値をDOMと購読者へ再同期する。
 *
 * mount時は、listener登録前に取り逃がしたstorage eventをこの現在値読取りで
 * catch-upする。localStorageが使えないタブの揮発選択は、mountだけで
 * 破棄しない。
 */
export function reconcileThemeFromStorage(): void {
  writeThemeToDom(readStoredPreference());
  cachedSnapshot = null;
  for (const callback of subscribers) callback();
}

/** 全ページ共通の storage listener から別タブのテーマをDOMへ同期する。 */
export function syncThemeFromStorage(): void {
  // 別タブの永続値が権威となるため、このタブの揮発fallbackは破棄する。
  volatilePreference = null;
  reconcileThemeFromStorage();
}

export function ThemeToggle() {
  const { preference, systemPrefersDark } = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const handleSelect = useCallback((next: ThemePreference) => {
    applyPreference(next);
  }, []);

  const effective: "light" | "dark" =
    preference === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : preference;

  return (
    <fieldset className="settings-theme-fieldset">
      <legend>テーマ(表示モード)</legend>

      <div className="settings-theme-options">
        {OPTIONS.map((option) => {
          const checked = preference === option.value;
          return (
            <label
              key={option.value}
              className="settings-theme-option"
              data-selected={checked ? "true" : "false"}
            >
              <input
                type="radio"
                name="theme-preference"
                value={option.value}
                checked={checked}
                onChange={() => handleSelect(option.value)}
                className="settings-theme-radio"
              />
              <span className="settings-theme-label">{option.label}</span>
            </label>
          );
        })}
      </div>

      <p aria-live="polite" className="settings-theme-status">
        現在の表示: {EFFECTIVE_LABEL[effective]}
        {preference === "system" ? "(システム設定に追従中)" : "(手動で固定中)"}
      </p>
    </fieldset>
  );
}
