import Link from "next/link";
import {
  DesignLinkButton,
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import { RULE_ITEM_COUNT, RULE_SECTIONS } from "./rulesContent";

/** Issue #712 Phase B3: 既存ルールを欠落させない黒金・和柄の閲覧画面。 */
export default function RulesPage({
  fontVariableClassName,
}: {
  readonly fontVariableClassName: string;
}) {
  return (
    <DesignPageShell className={`rules-page ${fontVariableClassName}`}>
      <main className="rules-main">
        <div className="rules-topbar">
          <nav aria-label="ページナビゲーション">
            <DesignLinkButton href="/" className="rules-back-link">
              <span aria-hidden="true">←</span>
              ロビーへ戻る
            </DesignLinkButton>
          </nav>
          <ScreenNavigation currentPath="/rules" />
        </div>

        <header className="rules-header">
          <p className="rules-kicker">遊び方と独自ルール</p>
          <h1 className="rules-title">ルール説明</h1>
          <p className="rules-introduction">
            四兄弟麻雀は、関西式三人打ちをベースに、一人ずつ抜け番を交代しながら進める四人回しの麻雀です。
          </p>
          <p className="rules-disclaimer">
            本作は粗品 Official
            Channel「ギャンブル四兄弟」を題材にした非公式ファンメイド作品です。
            公式のルール表は公開されておらず、本ページは動画内の描写・出演者の発言・ファンによるまとめをもとに整理した非公式の要約です。
          </p>
        </header>

        <DesignPanel className="rules-panel">
          <div className="rules-layout">
            <nav aria-label="ルールの目次" className="rules-toc-column">
              <details open className="rules-toc-disclosure">
                <summary className="rules-toc-summary">ルールの目次</summary>
                <div className="rules-toc-body">
                  <h2 className="rules-toc-heading">ルールの目次</h2>
                  <ol className="rules-toc-list">
                    {RULE_SECTIONS.map((section) => (
                      <li key={section.id}>
                        <a href={`#${section.id}`} className="rules-toc-link">
                          {section.heading}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </nav>

            <section
              aria-labelledby="rules-content-heading"
              className="rules-content"
            >
              <div className="rules-content-header">
                <h2 id="rules-content-heading" className="rules-content-title">
                  四兄弟麻雀のルール
                </h2>
                <p className="rules-content-meta">
                  全{RULE_SECTIONS.length}カテゴリ・{RULE_ITEM_COUNT}項目
                </p>
              </div>

              <div className="rules-sections">
                {RULE_SECTIONS.map((section) => (
                  <details
                    id={section.id}
                    key={section.id}
                    open={section.defaultOpen}
                    // A fragment targeting a descendant can make the browser
                    // expand this disclosure before React hydrates it.
                    suppressHydrationWarning
                    className="rules-section"
                  >
                    <summary
                      id={`${section.id}-summary`}
                      className="rules-section-summary"
                    >
                      <span>{section.heading}</span>
                      <span aria-hidden="true" className="rules-summary-mark">
                        {" "}
                      </span>
                    </summary>
                    <ul className="rules-item-list">
                      {section.items.map((item) => (
                        <li id={item.id} key={item.id} className="rules-item">
                          <span aria-hidden="true" className="rules-item-mark">
                            ◆
                          </span>
                          <p>
                            {item.label ? (
                              <strong className="rules-item-label">
                                {item.label}
                                <span aria-hidden="true">: </span>
                              </strong>
                            ) : null}
                            {item.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </DesignPanel>

        <aside aria-label="出典と注意事項" className="rules-source-note">
          <p>
            出典: <code>docs/四兄弟麻雀ルール.md</code>（非公式まとめ）
          </p>
          <p>収録回によって細部が変わる可能性があります。</p>
        </aside>

        <footer className="rules-footer">
          <Link href="/" className="rules-footer-link">
            <span aria-hidden="true">←</span> ロビーへ戻る
          </Link>
        </footer>
      </main>
    </DesignPageShell>
  );
}
