using System;
using System.Collections.Generic;

namespace FourBros.Display
{
    public sealed class FixtureScenario
    {
        public string name;
        public SeatMap seats;
        public PointMap points;
        public string roundLabel;
    }

    public sealed class FixtureScenarios
    {
        public readonly List<FixtureScenario> Cases = new List<FixtureScenario>();
        public readonly ContractFixture Contract;
        public readonly int DrawDurationMs;
        private readonly FixtureSlot[] physicalPlayers;

        public FixtureScenarios(ContractFixture fixture)
        {
            DisplayValidation.Require(fixture != null && fixture.schemaVersion == 1 &&
                fixture.schema == "com.autodevjapan.four-bros-mahjong/unity-display", "Unsupported fixture schema");
            DisplayValidation.Require(fixture.source != null && fixture.source.ruleAuthority == "server-and-domain" &&
                fixture.source.displayAuthority == "unity-client", "Unexpected fixture authority");
            DisplayValidation.Require(fixture.rotationCases != null && fixture.rotationCases.Length == 4 &&
                fixture.progressionCases != null && fixture.progressionCases.Length == 2 && fixture.visualCases != null,
                "Expected rotation/progression fixture cases");
            Contract = fixture;
            SlotShape shape = null;
            int duration = 0;
            foreach (var visual in fixture.visualCases)
            {
                if (visual.id == "bench-warmers") shape = visual.assertions.slotShape;
                if (visual.id == "hand-deal-draw-replacement-meld") duration = visual.assertions.drawEntranceDurationMs;
            }
            DisplayValidation.Require(shape != null && duration > 0, "Missing physical slots/animation fixture");
            DrawDurationMs = duration;
            physicalPlayers = new[] { shape.self, shape.left, shape.across, shape.right };
            foreach (var slot in physicalPlayers) DisplayValidation.Require(slot != null, "Missing physical fixture slot");
            foreach (var rotation in fixture.rotationCases)
            {
                Add(rotation.name + " / before", rotation.before, null, rotation.name + " / before");
                Add(rotation.name + " / after", rotation.after, null, rotation.name + " / after");
            }
            foreach (var progression in fixture.progressionCases)
            {
                Add(progression.name + " / before", progression.beforeSeats, progression.beforePoints, progression.beforeRound.ToString());
                Add(progression.name + " / after", progression.afterSeats, progression.afterPoints, progression.afterRound.ToString());
            }
        }

        private void Add(string name, SeatMap seats, PointMap points, string round)
        {
            Cases.Add(new FixtureScenario { name = name, seats = seats, points = points, roundLabel = round });
        }

        // Fixture-only projection. Seat assignments, progression and point values are read verbatim;
        // no game engine, seat rotation algorithm, tile wall, legal action or score calculation lives here.
        public DisplaySnapshot Snapshot(int caseIndex, long version, string effectKind = null, string transition = null)
        {
            var sample = Cases[caseIndex];
            string actor = sample.seats.east; // Explicit fixture actor, not an action/turn decision.
            var slots = new SlotDisplay[4];
            for (int i = 0; i < slots.Length; i++)
            {
                var physical = physicalPlayers[i];
                string wind = sample.seats.WindFor(physical.playerId);
                bool bench = wind == null;
                bool self = i == 0;
                slots[i] = new SlotDisplay
                {
                    position = DisplayValidation.Positions[i], playerId = physical.playerId,
                    bench = bench, seatWind = wind,
                    points = sample.points == null ? physical.points : sample.points.For(physical.playerId),
                    hand = !bench && self ? HandSample(transition) : Array.Empty<TileDisplay>(),
                    river = bench ? Array.Empty<TileDisplay>() : RiverSample(effectKind == "discard" && physical.playerId == actor),
                    drawn = !bench && self && transition != "meld" && transition != "deal" ? Tile(transition == "replacement" ? "N" : "7z") : null,
                    concealedCount = !bench && !self ? 13 : 0,
                    northCount = !bench && effectKind == "kita" && physical.playerId == actor ? 1 : 0
                };
            }
            var snapshot = new DisplaySnapshot
            {
                roomId = "fixture-818", version = version, roundLabel = sample.roundLabel, slots = slots,
                effect = effectKind == null ? null : new EffectDisplay { id = "fixture-" + version, kind = effectKind, playerId = actor },
                handTransition = transition
            };
            DisplayValidation.Validate(snapshot);
            return snapshot;
        }

        private static TileDisplay Tile(string label, bool red = false, bool sideways = false)
        {
            return new TileDisplay { label = label, red = red, sideways = sideways };
        }
        private static TileDisplay[] HandSample(string transition)
        {
            // Original symbolic placeholders matching the existing Web sample; not a legal-hand generator.
            string[] labels = transition == "meld"
                ? new[] { "2p", "3p", "4p", "5p", "4s", "5s", "6s", "1z", "1z", "5z" }
                : new[] { "1m", "2m", "3m", "2p", "3p", "4p", "5p", "4s", "5s", "6s", "1z", "1z", "5z" };
            var tiles = new TileDisplay[labels.Length];
            for (int i = 0; i < labels.Length; i++) tiles[i] = Tile(labels[i], labels[i] == "5p" || labels[i] == "5s");
            return tiles;
        }
        private static TileDisplay[] RiverSample(bool append)
        {
            var tiles = new List<TileDisplay>
            {
                Tile("1m"), Tile("5p", true), Tile("9s"), Tile("1z"), Tile("9m"), Tile("1p"),
                Tile("5s", true, true), Tile("4z"), Tile("2m"), Tile("8p"), Tile("2s"), Tile("7z")
            };
            if (append) tiles.Add(Tile("N"));
            return tiles.ToArray();
        }
    }
}
