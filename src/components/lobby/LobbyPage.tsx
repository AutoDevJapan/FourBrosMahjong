import {
  DesignLinkButton,
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import CharacterLineup from "@/components/lobby/CharacterLineup";

const secondaryDestinations = [
  {
    href: "/online",
    label: "オンライン対戦",
    description: "ルームコードで友人と対局",
  },
  {
    href: "/rules",
    label: "ルール説明",
    description: "四人回しサンマの遊び方",
  },
  {
    href: "/history",
    label: "戦績",
    description: "保存された半荘結果を確認",
  },
  {
    href: "/settings",
    label: "設定",
    description: "テーマと表示名を変更",
  },
] as const;

export interface LobbyPageProps {
  readonly fontVariableClassName: string;
}

/** Issue #712 Phase B1: 四兄弟を主役にしたロビー本体。 */
export default function LobbyPage({ fontVariableClassName }: LobbyPageProps) {
  return (
    <DesignPageShell className={`lobby-page ${fontVariableClassName}`}>
      <main className="lobby-main">
        <DesignPanel className="lobby-hero">
          <header className="lobby-header">
            <p className="lobby-kicker">四人で回す、三人麻雀</p>
            <h1 className="lobby-title">四兄弟麻雀</h1>
            <p className="lobby-introduction">
              関西式三人打ちをベースに、一人ずつ抜け番を交代しながら半荘を戦う麻雀ゲームです。
            </p>
          </header>

          <CharacterLineup />

          <nav aria-label="メインメニュー" className="lobby-menu">
            <DesignLinkButton
              href="/game"
              variant="primary"
              className="lobby-primary-action"
            >
              <span className="lobby-primary-label">対局を始める</span>
              <span className="lobby-primary-description">
                四人回しサンマ・半荘戦
              </span>
            </DesignLinkButton>

            <ul className="lobby-secondary-menu">
              {secondaryDestinations.map((destination) => (
                <li key={destination.href} className="min-w-0">
                  <DesignLinkButton
                    href={destination.href}
                    className="lobby-secondary-action"
                  >
                    <span className="min-w-0">
                      <span className="lobby-secondary-label">
                        {destination.label}
                      </span>
                      <span className="lobby-secondary-description">
                        {destination.description}
                      </span>
                    </span>
                    <span aria-hidden="true" className="lobby-action-arrow">
                      →
                    </span>
                  </DesignLinkButton>
                </li>
              ))}
            </ul>
          </nav>
        </DesignPanel>

        <footer className="lobby-footer">
          本作は粗品 Official
          Channel「ギャンブル四兄弟」を題材にした非公式ファンメイド作品です
          <p>
            運営事業者: AutoDevJapan · お問い合わせ:{" "}
            <a href="mailto:contact@autodevjapan.com">
              contact@autodevjapan.com
            </a>
          </p>
        </footer>
      </main>
    </DesignPageShell>
  );
}
