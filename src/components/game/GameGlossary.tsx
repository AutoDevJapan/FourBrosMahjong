"use client";

/**
 * 対局中に表示される麻雀用語の簡易用語集(#610)。
 *
 * 対局画面は情報量が多く、用語の横へ説明を常時並べると牌や操作パネルの
 * 発見性を下げる。そのため入口だけを卓中央へ置き、必要なときだけ既存の
 * アクセシブルな `Modal` で説明を開く。用語集は表示だけを担当し、対局の
 * 状態や操作には依存しない。
 */
import Link from "next/link";
import { useRef, useState } from "react";
import Modal from "../common/Modal";

interface GlossaryEntry {
  readonly term: string;
  readonly description: string;
}

export interface GlossarySection {
  readonly heading: string;
  readonly entries: readonly GlossaryEntry[];
}

/** 対局画面の表示語彙とルール要約に合わせた、初見向けの短い説明。 */
export const GAME_GLOSSARY: readonly GlossarySection[] = [
  {
    heading: "卓の表示",
    entries: [
      {
        term: "場・局",
        description:
          "東場/南場と、何局目かを表します。たとえば「東1局」は東場の1局目です。",
      },
      {
        term: "東家・南家・西家",
        description:
          "それぞれの席風です。東家が親で、局が進むと席風も順に回ります。",
      },
      {
        term: "本場",
        description:
          "親の連荘や流局で積み上がる積み棒の本数です。和了時の精算に影響します。",
      },
      {
        term: "供託",
        description:
          "リーチ棒など、卓上に預けられている点数です。和了や半荘終了時の精算対象になります。",
      },
      {
        term: "残り山",
        description:
          "これからツモれる山の残り枚数です。0枚になるとその局のツモが終わります。",
      },
      {
        term: "抜け番",
        description:
          "四人回しで、その局に卓へ入らず休むプレイヤーです。次の局で席へ戻ります。",
      },
    ],
  },
  {
    heading: "ドラ・ガリ",
    entries: [
      {
        term: "ドラ",
        description:
          "和了の点数を増やすボーナス牌です。ドラだけでは役にならず、和了できる手に加算されます。",
      },
      {
        term: "サイコロ",
        description:
          "開門位置と表ドラの枚数を決めます。通常は1枚、ゾロ目は2枚、6・6は3枚です。",
      },
      {
        term: "ガリ（抜き北）",
        description:
          "北を手牌から抜いて公開し、嶺上牌を1枚補充する仕組みです。抜いた北1枚ごとにドラが1枚増えます。",
      },
    ],
  },
  {
    heading: "操作の用語",
    entries: [
      {
        term: "ツモ",
        description:
          "自分で引いた牌で和了することです。ボタンが有効なときに選べます。",
      },
      {
        term: "ロン",
        description: "他のプレイヤーが捨てた牌で和了することです。",
      },
      {
        term: "リーチ",
        description:
          "門前でテンパイしたときの和了宣言です。成立後は手牌を選ばず、ツモ切りで進みます。",
      },
      {
        term: "ポン",
        description: "他のプレイヤーの捨て牌を使って同じ牌3枚の組を作ります。",
      },
      {
        term: "カン・暗槓・加槓",
        description:
          "同じ牌4枚を1組にする操作です。暗槓は手牌だけで、加槓は公開済みのポンへ4枚目を足して行います。",
      },
      {
        term: "ツモ切り",
        description:
          "今引いた牌をそのまま捨てることです。リーチ後はこの操作で進みます。",
      },
      {
        term: "スルー",
        description: "ロンやポンなど、他家の捨て牌への反応を見送ることです。",
      },
    ],
  },
  {
    heading: "状態の用語",
    entries: [
      {
        term: "副露",
        description:
          "ポンやカンなどで公開された面子です。自分の手牌の横に表示されます。",
      },
      {
        term: "フリテン",
        description:
          "決められた条件によりロンできない状態です。この対局ではツモ和了はできます。",
      },
      {
        term: "テンパイ",
        description:
          "あと1枚で和了できる状態です。リーチを宣言できるかの判定にも関係します。",
      },
    ],
  },
] as const;

export default function GameGlossary() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-tile-face px-3 py-1.5 text-tile-face text-xs font-medium hover:bg-foreground/5"
      >
        <span aria-hidden="true">?</span>
        対局中の用語を見る
      </button>

      {open ? (
        <Modal
          title="対局中の用語"
          onClose={() => setOpen(false)}
          returnFocusRef={openerRef}
        >
          <div className="flex flex-col gap-5 text-sm/6">
            <p className="text-foreground/75">
              対局画面で使っている言葉を、初めて遊ぶ方向けに説明します。
              牌の選択や打牌操作は、用語集を閉じるとそのまま続けられます。
            </p>

            {GAME_GLOSSARY.map((section) => (
              <section key={section.heading}>
                <h3 className="mb-2 font-semibold">{section.heading}</h3>
                <dl className="flex flex-col gap-3">
                  {section.entries.map((entry) => (
                    <div key={entry.term}>
                      <dt className="font-semibold">{entry.term}</dt>
                      <dd className="text-foreground/75">
                        {entry.description}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}

            <div className="border-t border-foreground/15 pt-3 text-xs/5 text-foreground/70">
              <p>詳しいルールや点数計算は、</p>
              <Link
                href="/rules"
                className="mt-1 inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm"
              >
                ルール説明を詳しく見る
              </Link>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
