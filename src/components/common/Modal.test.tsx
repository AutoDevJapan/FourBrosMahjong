import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Modal, { isRestoreFocusTarget } from "./Modal";

// console.warn のスパイがテスト失敗時に後続へ漏れないよう、毎回元へ戻す。
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Modal (spec 5.2.2 dialog / focus trap / Escape)", () => {
  it("公開: role=dialog + aria-modal + 見出しでラベル付けされる", () => {
    render(
      <Modal title="全体盤面" onClose={vi.fn()}>
        <button type="button">中身</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "全体盤面" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("開いたらダイアログへ初期フォーカスが移る", () => {
    render(
      <Modal title="全体盤面" onClose={vi.fn()}>
        <p>本文のみ</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "全体盤面" })).toHaveFocus();
  });

  it("Escape で onClose が呼ばれる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="全体盤面" onClose={onClose}>
        <button type="button">中身</button>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じるボタンで onClose が呼ばれる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="全体盤面" onClose={onClose}>
        <p>本文</p>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab フォーカストラップ: 末尾からダイアログ外へ出ず先頭へ循環する", async () => {
    const user = userEvent.setup();
    render(
      <Modal title="全体盤面" onClose={vi.fn()}>
        <button type="button">最初</button>
        <button type="button">最後</button>
      </Modal>,
    );
    // 可視フォーカス可能要素: 閉じる / 最初 / 最後。末尾(最後)から Tab で先頭(閉じる)へ戻る。
    const closeBtn = screen.getByRole("button", { name: "閉じる" });
    const lastBtn = screen.getByRole("button", { name: "最後" });
    lastBtn.focus();
    expect(lastBtn).toHaveFocus();
    await user.tab();
    expect(closeBtn).toHaveFocus();
  });

  it("閉じた後に開く前のフォーカス位置へ戻す", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
          {open ? (
            <Modal title="全体盤面" onClose={() => setOpen(false)}>
              <button type="button">中身</button>
            </Modal>
          ) : null}
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "開く" });
    opener.focus();
    await user.click(opener);
    // 開いた後、閉じるとトリガーへフォーカスが戻る。
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  // WebKit はポインターで button を起動してもフォーカスを移さないため、開いた時点の
  // activeElement はトリガーではない(#369)。jsdom の `user.click` は逆にトリガーを
  // フォーカスしてしまい条件を再現できないので、フォーカス副作用を持たない
  // `fireEvent.click` で「起動元が activeElement でない」状態を作る。
  function ReturnFocusHarness({ generation }: { generation: number }) {
    const [open, setOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement>(null);
    return (
      <div>
        <button
          key={generation}
          ref={openerRef}
          type="button"
          onClick={() => setOpen(true)}
        >
          開く
        </button>
        {open ? (
          <Modal
            title="全体盤面"
            onClose={() => setOpen(false)}
            returnFocusRef={openerRef}
          >
            <p>本文</p>
          </Modal>
        ) : null}
      </div>
    );
  }

  it("起動元がactiveElementでなくても明示した呼び出し元へ戻す", async () => {
    const user = userEvent.setup();
    render(<ReturnFocusHarness generation={0} />);
    const opener = screen.getByRole("button", { name: "開く" });

    fireEvent.click(opener);
    expect(opener).not.toHaveFocus();
    expect(screen.getByRole("dialog", { name: "全体盤面" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("表示中にトリガーが再マウントされても閉じた時点のノードへ戻す", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <ReturnFocusHarness generation={0} />,
    );
    // 開いている間は背景が aria-hidden になりロール照会から外れるため、
    // トリガーは Portal 外のコンテナから直接引く。
    const currentOpener = () =>
      container.querySelector("button") as HTMLButtonElement;
    const staleOpener = currentOpener();
    fireEvent.click(staleOpener);

    // key を変えてトリガーを作り直す。開いた時点で掴んだノードは DOM から外れる。
    rerender(<ReturnFocusHarness generation={1} />);
    const freshOpener = currentOpener();
    expect(freshOpener).not.toBe(staleOpener);
    expect(staleOpener.isConnected).toBe(false);

    await user.keyboard("{Escape}");
    expect(freshOpener).toHaveFocus();
  });

  // 復帰先が「DOM には接続されているがフォーカス不能」なケース(#377)。jsdom はレイアウトを
  // 持たず `display: none` / `visibility: hidden` を focus() の可否へ反映しないため、jsdom が
  // 実際に到達不能として扱う `disabled` でトリガーを封じて同じ条件を作る(実ブラウザでの
  // `display: none` シナリオは e2e/modal-focus.spec.ts が担保する)。
  function UnreachableTriggerHarness({
    triggerDisabled,
    withFallback,
  }: {
    triggerDisabled: boolean;
    withFallback: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement>(null);
    const fallbackRef = useRef<HTMLDivElement>(null);
    return (
      <div>
        {/* モーダルが補完している領域のルート。タブ順には入れずプログラム的復帰先にする。 */}
        <div ref={fallbackRef} tabIndex={-1} data-testid="fallback">
          盤面ルート
        </div>
        <button
          ref={openerRef}
          type="button"
          disabled={triggerDisabled}
          onClick={() => setOpen(true)}
        >
          開く
        </button>
        <button type="button">別の操作</button>
        {open ? (
          <Modal
            title="全体盤面"
            onClose={() => setOpen(false)}
            returnFocusRef={openerRef}
            fallbackFocusRef={withFallback ? fallbackRef : undefined}
          >
            <p>本文</p>
          </Modal>
        ) : null}
      </div>
    );
  }

  it("トリガーが到達不能なら開いた時点の activeElement へ連鎖する", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container, rerender } = render(
      <UnreachableTriggerHarness triggerDisabled={false} withFallback />,
    );
    const [opener, other] = Array.from(
      container.querySelectorAll("button"),
    ) as HTMLButtonElement[];

    // 開く直前の activeElement を「別の操作」にしたうえで、フォーカス副作用のない
    // fireEvent でモーダルを開く。
    other.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "全体盤面" })).toHaveFocus();

    // 表示中にトリガーが到達不能になる(実アプリでは卓幅変化による display: none)。
    rerender(<UnreachableTriggerHarness triggerDisabled withFallback />);
    await user.keyboard("{Escape}");

    expect(other).toHaveFocus();
    expect(warn).not.toHaveBeenCalled();
  });

  it("トリガーも開いた時点の activeElement も到達不能なら fallbackFocusRef へ連鎖する", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container, rerender } = render(
      <UnreachableTriggerHarness triggerDisabled={false} withFallback />,
    );
    const opener = container.querySelectorAll("button")[0] as HTMLButtonElement;

    // 開く時点の activeElement は <body>。復帰先として無効なため候補から外れる。
    expect(document.body).toHaveFocus();
    fireEvent.click(opener);
    rerender(<UnreachableTriggerHarness triggerDisabled withFallback />);
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("fallback")).toHaveFocus();
    expect(warn).not.toHaveBeenCalled();
  });

  it("候補がすべて到達不能なら黙って body へ落とさず開発ビルドで警告する", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container, rerender } = render(
      <UnreachableTriggerHarness
        triggerDisabled={false}
        withFallback={false}
      />,
    );
    const opener = container.querySelectorAll("button")[0] as HTMLButtonElement;

    fireEvent.click(opener);
    rerender(
      <UnreachableTriggerHarness triggerDisabled withFallback={false} />,
    );
    await user.keyboard("{Escape}");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("fallbackFocusRef");
  });

  it("復帰先の判定: <body>/<html> は復帰先にしない", () => {
    // jsdom では body.focus() が no-op のため、この除外は activeElement 判定だけでは
    // 再現できない(ブラウザでは成功して連鎖が止まる)。純関数として直接固定する。
    expect(isRestoreFocusTarget(document.body)).toBe(false);
    expect(isRestoreFocusTarget(document.documentElement)).toBe(false);
    expect(isRestoreFocusTarget(null)).toBe(false);
    expect(isRestoreFocusTarget(undefined)).toBe(false);

    // 未接続ノードは「戻すべき先はあったが到達できなかった」ケースとして扱うため、
    // ここでは弾かない(到達可否は restoreFocus が activeElement で実測する)。
    const detached = document.createElement("button");
    expect(isRestoreFocusTarget(detached)).toBe(true);
  });

  it("Portal 外のページ全体を inert にし、閉じると既存属性を復元する", () => {
    const { unmount } = render(
      <>
        <button type="button">背景ボタン</button>
        <Modal title="全体盤面" onClose={vi.fn()}>
          <p>本文</p>
        </Modal>
      </>,
    );
    const backgroundRoot = screen.getByRole("dialog").parentElement
      ?.previousElementSibling as HTMLElement | null;
    expect(backgroundRoot).not.toBeNull();
    expect(backgroundRoot).toHaveAttribute("inert");
    expect(backgroundRoot).toHaveAttribute("aria-hidden", "true");

    unmount();
    expect(backgroundRoot).not.toHaveAttribute("inert");
    expect(backgroundRoot).not.toHaveAttribute("aria-hidden");
  });

  it("表示中は背面 document のスクロールをロックし、閉じると解除する(#371)", () => {
    // ロックの中身(退避・復元・参照カウント)は documentScrollLock.test.ts が担保する。
    // ここでは Modal が開閉に合わせてロックを取得・解放する結線だけを見る。
    const { unmount } = render(
      <Modal title="全体盤面" onClose={vi.fn()}>
        <p>本文</p>
      </Modal>,
    );
    expect(document.body.style.position).toBe("fixed");

    unmount();
    expect(document.body.style.position).toBe("");
  });

  it("外部へ移されたフォーカスを回収し、Escape と復帰を維持する", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
          <button type="button">背景ボタン</button>
          {open ? (
            <Modal title="全体盤面" onClose={() => setOpen(false)}>
              <button type="button">中身</button>
            </Modal>
          ) : null}
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "開く" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "全体盤面" });

    (screen.getByText("背景ボタン") as HTMLButtonElement).focus();
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
