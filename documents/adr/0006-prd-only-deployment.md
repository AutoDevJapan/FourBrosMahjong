# ADR-0006: 稼働配備をPrdだけに統一する

## Status

Accepted — 2026-10-11のオーナー直接指示。対象はAutoDevJapan/FourBrosMahjongだけ。

## Decision

既存Vercelのmain→Productionと既存RailwayのPrdサービスを維持し、Preview/dev/stg/stagingを稼働環境として使わない。ADR-0001のPreview有効化と3環境昇格方針を置き換える。新しいproject・service・Prdサイトや有料バックアップを作らない。

Vercelの正式APIでPreview生成を無効化し、`vercel.json`でもmainだけを配備対象にする。過去配備は必要成果・依存とPrd動作を照合した後に廃止し、不在を再取得で確認する。GitHubの非Prd environmentsも使用設定・secret参照を確認して整合する。稼働配備を消してもソースのbranch・PR・未統合成果を消さない。

CIはmain宛てPRとmainへのpushを検査する。localhost・CI内の一時サーバーやDBは引き続き隔離検査に使う。稼働Prdの接続情報を検査へ移さない。

2026-10-12のオーナー直接指示により、古い一般的な人手レビュー・マージ・日常操作・再承認待ちを置き換える。人は要件と本人だけの判断を担当し、AIが設計・実装・検査・修正・別モデルレビュー・Must解消・同じheadのCI確認・PR経由のマージ・必要な既存Prd反映・後片付けまで行う。既存Discord回答を質問・本人・対象・範囲で照合し、再質問しない。

branch保護、既存の検査・受入・秘密保護・費用・Prd制約は維持する。顧客固有契約の人レビューと製品利用者の承認機能は変更しない。未指定要件、新費用、権利、新しい公開、顧客との新しい約束や不可逆な操作は本人だけが決める。稼働roomの消失を伴うメンテナンスや公開済みtagの例外操作を、通常の運用許可で実行しない。

## Data and rollback

設定・戦績はブラウザlocalStorage、単独対局の復元は同じタブのsessionStorageに保存される。旧オリジンの端末保存はPrdから取得・移送できず、provider上に移行対象DBがあるとは扱わない。利用者端末の内容を削除しない。

Railwayのroomはプロセスメモリ上にある。共有projectの他サービスとDBを廃止対象に含めず、Prdの再配備は既存runbookのload・rollback条件を満たす場合だけ行う。rollbackは保持するProduction履歴を使い、非Prdを再作成しない。

## Verification

[配備文書](../../docs/デプロイ環境運用.md)と共有ToDo #2371の製品別台帳に、providerの実ID・source・必要成果・機能検査・削除結果・再生成なし・PRとCIと実反映を保存する。設定無効化、PR作成、テストコードの存在だけで完了にしない。
