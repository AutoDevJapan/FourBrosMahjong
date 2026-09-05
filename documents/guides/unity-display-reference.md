# Unity表示リファレンス（#828）

`/prototype/unity-display` は、Unity Hub/Editor・アカウント認証・ライセンス有効化を後回しにして、Unityへ移植する表示契約をブラウザで確認するための専用ページである。

## 検証できること

- `documents/fixtures/unity-display-contract.json` の4つの表示ケース
- 3人着席＋1人抜け番の4物理スロット
- 河、リーチ宣言牌、手牌遷移、主要演出のWeb表示サンプル
- 固定seed `828` による既存Web対局盤面
- 4局の親流れ、連荘、東4→南1の席回転fixture

盤面本体は `GameProvider` / `GameBoard` / `GameViewState` を再利用する。表示契約のリファレンス専用コードでルール計算・点数計算・席割りを複製しない。

## ローカル確認

```bash
pnpm exec vitest run --project component src/components/prototype/UnityDisplayReference.test.tsx
pnpm exec playwright test e2e/unity-display-reference.spec.ts
```

開発サーバー起動後は、`http://localhost:3000/prototype/unity-display` を開く。Vercel Preview/Productionでも同じパスを確認する。

## このページで完了扱いにしないこと

これはUnity Runtimeの検証ではない。Unity C#・Prefab・Animator・Unity WebGLビルド、iOS/Android実機性能、入力遅延、ビルドサイズ、第三者アセットの権利確認は後続Issueの対象とする。

現fixtureの `source.snapshotVersion` は `42` を基準値とし、`source.snapshotVersionSequence` に `41 → 42 → 41 → 42 → 43` の適用/無視期待値を収録している。`src/test/unity-display-contract.test.ts` がこのsequenceを検証するが、このページ自体はWebリファレンスであり、Unity Runtimeのversion適用検証済みとは扱わない。
