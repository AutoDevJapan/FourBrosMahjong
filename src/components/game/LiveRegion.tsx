"use client";

/**
 * スクリーンリーダ向けライブリージョン(スペック5 5.2.3)。
 *
 * 局進行(手番交代・ドラめくり・リーチ宣言等)は `polite`、結果確定(和了・流局・半荘終了)は
 * `assertive`(`role="alert"`)で通知する。文言整形のみを担い、いつ何を通知するかの判断は
 * 呼び出し側(将来のドメイン/進行制御)が決める。視覚的には隠すが DOM には常駐させておく
 * (領域が後から生えると読み上げが不安定になるため)。
 */
export interface LiveRegionProps {
  /** 進行通知(`aria-live="polite"`)。 */
  politeMessage?: string;
  /** 結果確定通知(`role="alert"` = `aria-live="assertive"`)。 */
  assertiveMessage?: string;
}

export default function LiveRegion({
  politeMessage = "",
  assertiveMessage = "",
}: LiveRegionProps) {
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {politeMessage}
      </div>
      <div role="alert" aria-atomic="true" className="sr-only">
        {assertiveMessage}
      </div>
    </>
  );
}
