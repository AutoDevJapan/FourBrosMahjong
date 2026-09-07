# #725 Option B: 採用と移行の実行記録

## 結論と承認範囲

2026-09-08 JST、owner が会話内の A/B 説明を確認して **「Bで進めて」** と明示した。
PR Preview → main Production を採用し、dev/stg への後追い昇格を廃止する。
[ADR-0006](../../documents/adr/0006-preview-production-topology.md) は Accepted とし、
ADR-0001 の配置先・Preview 有効は維持する。

**採用は承認済み、実環境の切替は未完**。この選択を、Preview QA・実装 PR の merge 合格・
画像利用権・Railway 変更の承認として拡張しない。#818/#1165 の Unity 変更は本 PR に混ぜない。

## 変更直前の read-back（2026-09-08 JST）

GitHub API、`git ls-remote`、認証済み Vercel CLI の GET で確認した。
Vercel の project 応答からは必要な設定だけを抽出し、環境変数や秘密情報の値は出力していない。

| 対象 | 確認結果 |
|---|---|
| repository / default branch | AutoDevJapan/FourBrosMahjong / main |
| remote main | `2074f2cae28745907396c957a21c63b944dd8b3a` |
| remote dev | 不在（再作成しない） |
| remote stg | `e240ceb585ca676147e0b44e79c88fa0c8871cf8`、main に無い commit は13件 |
| Vercel project | `four-bros-mahjong` / `prj_n78l4eqVu7t0Z5mtcvDeHbNG3cbi` |
| Vercel team | `team_Hh2mAEEcMesxsuaVTP5DMxui`、既存 scope `masashi-matsumotos-projects-c5830f3d` |
| Git integration | GitHub AutoDevJapan/FourBrosMahjong、Production branch `main` |
| PR comments | `onPullRequest=true`、`onCommit=false` |
| Preview 保護 | `ssoProtection.deploymentType=all_except_custom_domains`。変更しない |
| Vercel custom staging | `env_GCU8mE9ncqDgAZwoIMTSG6rR56RZ`、type preview、branch matcher equals `stg` |
| GitHub staging environment | ID `17953193797`、protection rules 空、deployment branch policy null |
| 維持する GitHub environments | Preview `17952391175` / Production `17952309708` |
| main protection | strict required checks `gitleaks` / `lint / typecheck / format / test / build`。enforce admins=true、force push/delete=false、required approving review count=0 |

この inventory は削除直前に再取得する。不一致を無視して旧 ref/environment を削除しない。

## stg 履歴の保全と復元検証

アクセス制限されたローカル保存先:
`/Users/akashikota/Downloads/FourBrosMahjong-topology-backup-20260908.ZqYrdr/stg.bundle`

- bundle: 2,041,317 bytes、SHA-256 `8986087511beba79ddfc6b3cf111e3ed44425e47ebfde585c9167053f1800733`
- 保全 ref: `refs/remotes/origin/stg`、full SHA は上表と一致。完全履歴416 commitsを含む。
- `git bundle verify` は complete history として成功。
- 独立した bare repository へ bundle の ref を明示して fetch し、`git fsck --full` 成功、
  `refs/heads/stg` が上記 full SHA であることを読み戻した。
- 通常の bare clone は bundle 内の remote-tracking ref を heads として復元せず空になるため、
  次のように **source ref と destination ref を明示**する。

```sh
git init --bare /path/to/new-restore.git
git --git-dir=/path/to/new-restore.git fetch /path/to/stg.bundle \
  refs/remotes/origin/stg:refs/heads/stg
git --git-dir=/path/to/new-restore.git fsck --full
git --git-dir=/path/to/new-restore.git rev-parse refs/heads/stg
```

bundle は本 repository の tracked tree や公開 artifact に置かない。
これは履歴の保全であり、Vercel の環境変数・provider settings の完全バックアップではない。
外部 staging を整理する直前に、必要な設定と秘密情報の管理先を認証された担当者が確認する。

## Repository の実装

- `ci.yml` の PR base / push 対象を main に限定。workflow_dispatch は維持。
- `verification-scope.mjs` の dev/stg 昇格特例を削除。main 以外の直接入力も skip を拒否。
- main の trusted PR check、before→PR head ancestry、tree 一致、証拠不足時の全検証を維持。
- main のみへの cache 保存、concurrency、required check 名・権限、全 PR の gitleaks を維持。
- ADR / README / 運用・品質文書 / AGENTS.md を B に整合。共有 agents.prompt は編集しない。

## ローカル検証

`origin/main@2074f2c` から作った専用 worktree で、lockfile 固定の依存を独立導入して実行した。

| コマンド／検査 | 結果 |
|---|---|
| `pnpm check` / `pnpm typecheck` / `pnpm lint` | 成功（Biome 2.5.12） |
| CI scope の対象テスト | 170 tests 成功 |
| `pnpm test` | 208 files / 2,816 tests 成功、232.62秒 |
| `pnpm build` | Next.js 16.3.4 の production build 成功 |
| ローカル production E2E | CI と同じ E2E build flags、system Chrome、workers=1 / retries=0 で対象6 spec・93 tests 成功（1.8分） |
| `pnpm knip` / `pnpm depcruise` | 成功。依存検査は439 modules / 1,434 dependencies |
| workflow YAML の構造比較 | PR base / push の branch filters 以外は main と完全一致 |
| 文書内リンク | 対象7文書のローカルリンク45件を解決 |
| bundle の独立復元 | stg の416 commits、うち main に無い13 commitsすべてを確認 |
| `git diff --check` | 成功 |

`verify:actions:policy` の追加呼出しは判定入力を渡していなかったため、仕様どおり
`hold / invalid-schema` で非zero終了した。これは Actions 設定変更を承認する証拠ではなく、
そのまま保護設定の変更へ使っていない。判定器の正常／拒否ケースは上記 Vitest で検証する。

ローカル production E2E は CI と同じ E2E build flags と system Chrome、新規 context、workers=1 を使う。
初回は一時 Playwright 設定を出力ディレクトリ直下へ置いてしまい、起動時の出力清掃で
設定自体が削除され、93件がテスト本体の実行前に失敗した。出力先を専用サブディレクトリへ
分離して再検証した。続く実行は44件成功後、リーチ局面の到達で失敗した。原因は通常の
production build に対して seed 前提の E2E を実行したことだった。通常配布では URL seed を
無効にする既存実装が正しく動作しており、CI が指定する `NEXT_PUBLIC_E2E_SEED_ENABLED=1`
をローカル build に渡していなかった。CI と同じ build 設定へ揃えた再検証は93件すべて成功した。
いずれもアプリや CI の設定変更ではなく、検証用一時設定・実行条件の修正である。
対象は `pwa-offline` / `persistence` / `modal-focus` / `security-headers` / `metadata` / `a11y` の6 spec。
これはローカル Chromium 相当の補助検証であり、CI の全ブラウザ matrix や認証済み Preview QA の代替ではない。

## 残る実行ゲート

| 段階 | 状態 |
|---|---|
| B 採用 | owner の会話内明示承認を記録済み |
| local 検証・reviewed docs/infra PR | ローカルの実装・回帰検証は上記。認証済み Preview と review 待ちの PR として公開する |
| exact PR head の認証済み Preview QA | 未完。Browser 接続は `No browser is available`、接続可能一覧も空。認証済み session が必要 |
| UI/character rights と release 判断 | #725 の独立した未完ゲートとして継続 |
| PR merge / Production exact deployment | 上記ゲート通過後。不要な再deployはしない |
| Vercel staging / GitHub staging / remote stg 整理 | 未実施。review/Preview と通常公開後検証、設定保全、直前 read-back 後に実施 |
| rollback / promote / 環境復元担当 | merge 前に担当者を記録する |

ローカルの公開 Production 検査は[別の証跡](./2026-09-08-725-acceptance-evidence.md)を再利用し、
新しい PR head の Preview / Production 合格には流用しない。Preview の保護解除、認証迂回、
Railway の設定・再起動・deploy は行わない。
