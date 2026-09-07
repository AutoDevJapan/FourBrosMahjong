using System;
using System.Collections.Generic;

namespace FourBros.Display
{
    // Fixture DTOs use fields because Unity JsonUtility does not deserialize properties/dictionaries.
    [Serializable] public sealed class ContractFixture
    {
        public string schema;
        public int schemaVersion;
        public FixtureSource source;
        public RotationCase[] rotationCases;
        public ProgressionCase[] progressionCases;
        public VisualCase[] visualCases;
    }
    [Serializable] public sealed class FixtureSource
    {
        public long snapshotVersion;
        public VersionStep[] snapshotVersionSequence;
        public string ruleAuthority, displayAuthority;
    }
    [Serializable] public sealed class VersionStep { public long version; public string expected; }
    [Serializable] public sealed class SeatMap
    {
        public string east, south, west, bench;
        public string WindFor(string player)
        {
            if (player == bench) return null;
            if (player == east) return "east";
            if (player == south) return "south";
            if (player == west) return "west";
            throw new ArgumentException("Player is absent from supplied seat map: " + player);
        }
    }
    [Serializable] public sealed class RotationCase { public string name; public SeatMap before, after; }
    [Serializable] public sealed class RoundDisplay
    {
        public string wind;
        public int handNumber, honba;
        public override string ToString() { return wind + " " + handNumber + " / honba " + honba; }
    }
    [Serializable] public sealed class PointMap
    {
        public int p0, p1, p2, p3;
        public int For(string id)
        {
            switch (id)
            {
                case "p0": return p0; case "p1": return p1;
                case "p2": return p2; case "p3": return p3;
                default: throw new ArgumentException("Unknown fixture player " + id);
            }
        }
    }
    [Serializable] public sealed class ProgressionCase
    {
        public string name;
        public RoundDisplay beforeRound, afterRound;
        public SeatMap beforeSeats, afterSeats;
        public PointMap beforePoints, afterPoints;
    }
    [Serializable] public sealed class VisualCase { public string id; public VisualAssertions assertions; }
    [Serializable] public sealed class VisualAssertions
    {
        public string[] kinds, transitionKinds;
        public int drawEntranceDurationMs;
        public SlotShape slotShape;
    }
    [Serializable] public sealed class SlotShape { public FixtureSlot self, left, across, right; }
    [Serializable] public sealed class FixtureSlot { public string kind, playerId, seatWind; public int points; }

    // Proposed display-only input, not an implementation of OnlineSnapshot or a public wire schema.
    [Serializable] public sealed class DisplaySnapshot
    {
        public int schemaVersion = 1;
        public string roomId, roundLabel;
        public long version;
        public SlotDisplay[] slots;
        public EffectDisplay effect;
        public string handTransition;
    }
    [Serializable] public sealed class SlotDisplay
    {
        public string position, playerId, seatWind;
        public bool bench;
        public int points, concealedCount, northCount;
        public TileDisplay[] hand, river;
        public TileDisplay drawn;
    }
    [Serializable] public sealed class TileDisplay
    {
        public string label;
        public bool red, sideways;
    }
    [Serializable] public sealed class EffectDisplay { public string id, kind, playerId; }

    public static class DisplayValidation
    {
        public static readonly string[] Positions = { "self", "left", "across", "right" };
        public static void Require(bool condition, string message)
        {
            if (!condition) throw new ArgumentException(message);
        }
        public static void Validate(DisplaySnapshot snapshot)
        {
            Require(snapshot != null && snapshot.schemaVersion == 1, "Unsupported display schema");
            Require(!string.IsNullOrEmpty(snapshot.roomId) && snapshot.version >= 0, "Invalid room/version");
            Require(snapshot.slots != null && snapshot.slots.Length == 4, "Expected four physical slots");
            var positions = new HashSet<string>();
            var players = new HashSet<string>();
            var winds = new HashSet<string>();
            int benches = 0;
            foreach (var slot in snapshot.slots)
            {
                Require(slot != null, "Null slot");
                Require(Array.IndexOf(Positions, slot.position) >= 0 && positions.Add(slot.position), "Duplicate/invalid position");
                Require(!string.IsNullOrEmpty(slot.playerId) && players.Add(slot.playerId), "Duplicate/invalid player");
                Require(slot.hand != null && slot.river != null, "Missing tile arrays");
                Require(slot.concealedCount >= 0 && slot.concealedCount <= 18 && slot.northCount >= 0, "Invalid display counts");
                Require(slot.hand.Length <= 18 && slot.river.Length <= 60, "Oversized display arrays");
                foreach (var tile in slot.hand) Require(tile != null && !string.IsNullOrEmpty(tile.label), "Invalid hand tile");
                foreach (var tile in slot.river) Require(tile != null && !string.IsNullOrEmpty(tile.label), "Invalid river tile");
                if (slot.drawn != null) Require(!string.IsNullOrEmpty(slot.drawn.label), "Invalid drawn tile");
                if (slot.bench)
                {
                    benches++;
                    Require(string.IsNullOrEmpty(slot.seatWind), "Bench cannot have a seat wind");
                    Require(slot.hand.Length == 0 && slot.river.Length == 0 && slot.drawn == null && slot.concealedCount == 0 && slot.northCount == 0, "Bench cannot have table tiles");
                }
                else
                {
                    Require((slot.seatWind == "east" || slot.seatWind == "south" || slot.seatWind == "west") && winds.Add(slot.seatWind), "Invalid/duplicate seat wind");
                    Require(slot.position == "self" || (slot.hand.Length == 0 && slot.drawn == null), "Opponent tile faces must not enter display input");
                }
            }
            Require(benches == 1, "Expected three seated players and one bench");
            if (snapshot.effect != null)
            {
                Require(!string.IsNullOrEmpty(snapshot.effect.id), "Effect needs a committed identity");
                Require(Array.IndexOf(EffectKinds, snapshot.effect.kind) >= 0, "Unknown effect");
                Require(string.IsNullOrEmpty(snapshot.effect.playerId) || players.Contains(snapshot.effect.playerId), "Effect player missing");
            }
            Require(snapshot.handTransition == null || Array.IndexOf(TransitionKinds, snapshot.handTransition) >= 0, "Unknown hand transition");
        }
        public static readonly string[] EffectKinds = { "discard", "riichi", "pon", "kan", "kita", "tsumo", "ron", "draw", "roundEnd" };
        public static readonly string[] TransitionKinds = { "deal", "draw", "replacement", "meld" };
    }

    public sealed class DisplaySession
    {
        public DisplaySnapshot Current { get; private set; }
        public bool Animate { get; private set; }
        public EffectDisplay Effect { get; private set; }
        private readonly HashSet<string> seenEffects = new HashSet<string>();

        // Snapshot ownership is transferred to the display; callers must not mutate it after Apply.
        public bool Apply(DisplaySnapshot next, bool restore = false)
        {
            DisplayValidation.Validate(next); // Reject invalid input before advancing the version.
            bool sameRoom = Current != null && next.roomId == Current.roomId;
            if (sameRoom && next.version <= Current.version) return false;
            bool sameRound = sameRoom && next.roundLabel == Current.roundLabel;
            if (!sameRoom || !sameRound) seenEffects.Clear();
            Animate = sameRoom && !restore;
            bool freshEffect = next.effect != null && seenEffects.Add(next.effect.id);
            Effect = Animate && freshEffect ? next.effect : null;
            Current = next;
            return true;
        }
    }

    public struct TilePlacement
    {
        public float x, z, yaw;
        public TilePlacement(float x, float z, float yaw) { this.x = x; this.z = z; this.yaw = yaw; }
    }
    public static class DisplayLayout
    {
        public const float TileWidth = .30f, TileDepth = .42f, TileHeight = .16f, Spacing = .05f, DrawGap = .28f;
        public static TilePlacement[] River(TileDisplay[] tiles, int columns = 6)
        {
            DisplayValidation.Require(columns >= 1 && columns <= 6, "River columns must be 1..6");
            var result = new TilePlacement[tiles.Length];
            for (int start = 0; start < tiles.Length; start += columns)
            {
                // Each row shares its leading edge; a reach tile consumes its rotated width.
                float cursor = -1.35f;
                for (int i = start; i < Math.Min(start + columns, tiles.Length); i++)
                {
                    float width = tiles[i].sideways ? TileDepth : TileWidth;
                    result[i] = new TilePlacement(cursor + width / 2, -(start / columns) * (TileDepth + Spacing), tiles[i].sideways ? 90 : 0);
                    cursor += width + Spacing;
                }
            }
            return result;
        }
        public static float HandX(int index, int count, bool drawn)
        {
            return (index - (count - 1) / 2f) * (TileWidth + Spacing) + (drawn ? DrawGap : 0);
        }
        public static float SeatYaw(string position)
        {
            switch (position)
            {
                case "self": return 0; case "left": return 90;
                case "across": return 180; case "right": return 270;
                default: throw new ArgumentException("Invalid physical slot");
            }
        }
    }
}
