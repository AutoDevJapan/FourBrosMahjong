import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Modal from "./Modal";

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
