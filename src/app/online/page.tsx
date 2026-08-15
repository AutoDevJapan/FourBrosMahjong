import type { Metadata } from "next";
import Link from "next/link";
import { socialMetadata } from "@/app/_lib/metadata";
import OnlineLobby from "@/components/online/OnlineLobby";

const description =
  "ルームコードを共有して、別端末の友人と四兄弟麻雀をオンライン対戦できます。";

export const metadata: Metadata = {
  title: "オンライン対戦",
  description,
  ...socialMetadata({
    title: "オンライン対戦 | 四兄弟麻雀",
    description,
    path: "/online",
  }),
};

export default function OnlinePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <main className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="text-sm text-foreground/70 hover:underline">
            ロビーへ戻る
          </Link>
        </header>
        <OnlineLobby />
      </main>
    </div>
  );
}
