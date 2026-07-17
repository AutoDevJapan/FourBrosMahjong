# カスタムドメイン公開手順(Vercel prd)

本番(prd)を独自のカスタムドメインで公開するための手順です。対象は Vercel プロジェクト `four-bros-mahjong`(team: Masashi Matsumoto's projects)の Production 環境。

デプロイ構成の意思決定は [ADR-0001](../adr/0001-deploy-architecture-and-preview-policy.md)、環境定義・昇格フローは [`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) を参照。

## 現状(2026-07-17 時点)

- `four-bros-mahjong` の Production は `four-bros-mahjong.vercel.app` で公開中。
- **カスタムドメインは未割当**。以下は割当を行う際の手順であり、実際のドメイン名の確定と DNS 設定は運用担当の手作業として残る。

## 前提

- 公開に使うドメインを取得済みであること(レジストラは任意)。
- Vercel team `four-bros-mahjong` プロジェクトへの管理権限があること。
- DNS を操作できる権限(レジストラまたは DNS プロバイダの管理画面)があること。

## 手順

### 1. Vercel にドメインを追加

1. Vercel ダッシュボード → プロジェクト `four-bros-mahjong` → **Settings → Domains**。
2. 公開するドメイン(例: `example.com` または `www.example.com`)を入力して **Add**。
3. 割り当て先の環境は **Production**(`main` ブランチ)を選ぶ。

CLI で行う場合(`--scope` にチーム ID を指定):

```bash
# ドメインをプロジェクトの Production に紐付ける
vercel domains add <domain> four-bros-mahjong --scope masashi-matsumotos-projects-c5830f3d
```

### 2. DNS レコードを設定

Vercel が表示する検証用レコードを、DNS プロバイダ側に設定する。一般的には次のいずれか。

| ドメイン種別 | レコード種別 | 値 |
|---|---|---|
| Apex(`example.com`) | `A` | Vercel が案内する IP(通常 `76.76.21.21`。必ずダッシュボードの表示値を使う) |
| サブドメイン(`www.example.com`) | `CNAME` | `cname.vercel-dns.com`(必ずダッシュボードの表示値を使う) |

- Apex ドメインを使う場合、レジストラが `ALIAS`/`ANAME`(Apex での CNAME 相当)に対応していればそちらを推奨。
- Vercel のネームサーバーへ移管する運用も可能だが、他サービスの DNS と共存させる場合はレコード単位設定のほうが影響範囲が小さい。

### 3. 検証と SSL

1. DNS 伝播後、Vercel の Domains 画面でステータスが **Valid Configuration** になることを確認する。
2. SSL 証明書(Let's Encrypt)は Vercel が自動発行・更新する。手動設定は不要。
3. Apex とサブドメインの両方を追加した場合は、片方をもう片方へリダイレクトする設定(例: `example.com` → `www.example.com`)を Vercel の Redirect で行う。

### 4. 動作確認(受け入れ確認)

- `https://<domain>/` が Production の最新デプロイを返すこと。
- HTTP が HTTPS にリダイレクトされること。
- 主要ルート(`/`、`/rules`、`/settings`、`/game`)が 200 で表示されること。

CLI で現在の割当を確認:

```bash
vercel domains ls --scope masashi-matsumotos-projects-c5830f3d
vercel project inspect four-bros-mahjong --scope masashi-matsumotos-projects-c5830f3d
```

## 環境変数・バックエンド連携との整合

- カスタムドメインは**フロントエンド(Vercel Production)**の公開先。バックエンド(将来 Railway、[ADR-0001](../adr/0001-deploy-architecture-and-preview-policy.md))の API ドメインは別に管理する。
- フロントからバックエンド API を呼ぶ URL は環境変数(`Production` スコープ)で管理し、リポジトリにはコミットしない([`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) の「環境変数の管理方針」を参照)。
- カスタムドメインを本番 API の CORS 許可オリジンに含める必要が出た場合は、バックエンド着手時の issue で対応する。

## 注意

- DNS 設定・ドメイン購入・SSL 発行は外部サービス上の手作業であり、本リポジトリのコードでは自動化しない。
- 実際にドメインを確定・割当した後は、[`docs/デプロイ環境運用.md`](../../docs/デプロイ環境運用.md) の環境定義表の prd URL を実ドメインに更新すること。
