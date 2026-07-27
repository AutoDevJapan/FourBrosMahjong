import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ページが見つかりません",
  description: "指定されたページは存在しないか、移動した可能性があります。",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-8 text-center">
      <p className="text-sm font-semibold tracking-widest text-foreground/60">
        404
      </p>
      <h1 className="text-3xl font-bold">ページが見つかりません</h1>
      <p className="text-sm/6 text-foreground/70">
        指定されたページは存在しないか、移動した可能性があります。
      </p>
      <nav
        aria-label="ページが見つからない場合の移動先"
        className="flex flex-wrap justify-center gap-3"
      >
        <Link
          href="/"
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
        >
          ロビーへ戻る
        </Link>
        <Link
          href="/rules"
          className="rounded-full border border-control-border px-5 py-2 text-sm"
        >
          ルールを見る
        </Link>
      </nav>
    </main>
  );
}
