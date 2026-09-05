import Image from "next/image";
import { useId } from "react";
import { characterAccentStyle } from "@/components/game/CharacterPortrait";
import {
  CHARACTER_PLAYER_IDS,
  characterProfile,
} from "@/domain/game/characters";

/** #711のID→名前→画像→色をSSOTから描画するロビー用lineup。 */
export default function CharacterLineup() {
  const nameIdPrefix = useId();

  return (
    <section aria-label="四兄弟" className="lobby-characters">
      {CHARACTER_PLAYER_IDS.map((playerId) => {
        const profile = characterProfile(playerId);
        const nameId = `${nameIdPrefix}-${playerId}-name`;
        return (
          <article
            key={playerId}
            aria-labelledby={nameId}
            data-character-id={playerId}
            style={characterAccentStyle(playerId)}
            className="lobby-character-card"
          >
            <div className="lobby-character-image-frame">
              <Image
                unoptimized
                src={profile.portraitSrc}
                alt=""
                width={220}
                height={420}
                className="lobby-character-image"
                fetchPriority={playerId === "p0" ? "high" : "auto"}
                loading={playerId === "p0" ? "eager" : "lazy"}
              />
            </div>
            <h2 id={nameId} className="lobby-character-name">
              {profile.defaultName}
            </h2>
          </article>
        );
      })}
    </section>
  );
}
