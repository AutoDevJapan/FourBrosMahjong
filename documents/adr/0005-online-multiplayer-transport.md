# ADR-0005: オンライン対戦の Vercel + Railway WebSocket 構成

## Status

Accepted

## Date

2026-08-15

## Context

オンライン対戦では、複数ブラウザから同じ対局状態を共有し、プレイヤーの操作順序をサーバー側で検証する必要がある。Vercel の Next.js 実行環境は画面配信に適している一方、常時接続する WebSocket のルームプロセスには Railway を使う既存方針がある。

## Decision

1. Vercel の `/online` がロビーと対局 UI を提供し、`NEXT_PUBLIC_ONLINE_WS_URL` で Railway の WebSocket エンドポイントへ接続する。
2. Railway の `server/index.ts` が `ws` による接続 `/ws`、プロセス liveness `/healthz`、configuration/readiness healthcheck `/readyz` を提供し、既存のゲームエンジンを権威的に実行する。
3. ルーム作成時に 4 席(`p0`〜`p3`)を確保し、未接続の席は AI として進行する。参加者には匿名の再接続トークンを発行し、ブラウザの `sessionStorage` に保存する。
4. ルーム・座席・対局状態は当面プロセス内メモリに保持する。Railway の再起動時にルームを復元しない。認証、DB/Redis による永続化、水平スケールはこの MVP の範囲外とする。
5. 操作にはルームのバージョンとプレイヤーIDを含め、サーバーは手番・座席所有権・入力牌を検証してから次のスナップショットを全参加者へ配信する。各参加者には自分の手牌を中心とした View を返し、他人の非公開情報と他人向け pending 操作は送信しない。
6. 明示北抜きは `create` / `join` / `resume` の任意 capability `explicitKita` で席単位に交渉する。欠落する旧clientは従来の自動ガリ、新clientは手動操作とし、snapshotでcapabilityが欠落する旧serverへ接続した新clientは自動ガリとして `kita` actionを送らない。切断中も席のcapabilityを保持し、resumeと新半荘の接続中rosterへ引き継ぐ(issue #708)。

## Consequences

- Vercel は静的な画面配信と既存 PWA の責務に集中でき、Railway は長時間 WebSocket 接続を担当できる。
- 匿名ルームコードだけで試せるため導入は軽いが、ユーザーアカウント、対局履歴の共有、迷惑行為対策は別途必要になる。
- インメモリ構成は単純で低遅延だが、再起動でルームが失われ、複数インスタンスへそのまま拡張できない。
- Railway の `ALLOWED_ORIGINS` と Vercel の `NEXT_PUBLIC_ONLINE_WS_URL` を環境ごとに設定する必要がある。

## Rollback Plan

`/online` への導線を隠し、Vercel の `NEXT_PUBLIC_ONLINE_WS_URL` を未設定に戻せば、既存のローカル対局機能へ戻せる。サーバー側は Railway サービスを停止または以前のデプロイへ戻す。既存のドメイン層・`/game` 画面には依存しない。

## Related

- [ADR-0001](./0001-deploy-architecture-and-preview-policy.md) — Vercel フロントエンド + Railway バックエンドの配置方針
- [`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) — 環境変数、起動、ヘルスチェック、運用手順
- [`railway.json`](../../railway.json) — Railway の build/deploy 定義
