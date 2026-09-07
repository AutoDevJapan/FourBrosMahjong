using System;
using System.Collections.Generic;

namespace FourBros.Display
{
    // Shared executable assertions: runs in Unity's Editor menu OR .NET without Unity assemblies/NUnit.
    public static class DisplayContractChecks
    {
        private static int checks;
        private static void Check(bool condition, string message)
        {
            checks++;
            if (!condition) throw new InvalidOperationException("Display check failed: " + message);
        }
        private static void Reject(Action action, string message)
        {
            try { action(); }
            catch (ArgumentException) { checks++; return; }
            throw new InvalidOperationException("Expected rejection: " + message);
        }
        private static void Near(float a, float b, string message) { Check(Math.Abs(a - b) < .0001f, message); }

        private static void CheckRiverSeparation(DisplaySnapshot snapshot, int columns)
        {
            var placements = new List<TilePlacement>();
            var names = new List<string>();
            foreach (var slot in snapshot.slots)
            {
                var river = DisplayLayout.RiverOnBoard(slot.river, slot.position, columns);
                Check(river.Length == slot.river.Length, "board placement preserves every river tile");
                for (int i = 0; i < river.Length; i++)
                {
                    Near(river[i].yaw, (DisplayLayout.SeatYaw(slot.position) + (slot.river[i].sideways ? 90 : 0)) % 360,
                        "board placement preserves seat and reach orientation");
                    placements.Add(river[i]);
                    names.Add(slot.position + "[" + i + "]");
                }
            }
            float minimumGap = float.MaxValue;
            string closestPair = "";
            for (int i = 0; i < placements.Count; i++)
            {
                var a = placements[i];
                float aw = (a.yaw % 180 == 0 ? DisplayLayout.TileWidth : DisplayLayout.TileDepth) / 2;
                float ad = (a.yaw % 180 == 0 ? DisplayLayout.TileDepth : DisplayLayout.TileWidth) / 2;
                for (int j = i + 1; j < placements.Count; j++)
                {
                    var b = placements[j];
                    float bw = (b.yaw % 180 == 0 ? DisplayLayout.TileWidth : DisplayLayout.TileDepth) / 2;
                    float bd = (b.yaw % 180 == 0 ? DisplayLayout.TileDepth : DisplayLayout.TileWidth) / 2;
                    // The fixture uses quarter turns, so these are exact tile bounds in board space.
                    float gap = Math.Max(Math.Abs(a.x - b.x) - aw - bw, Math.Abs(a.z - b.z) - ad - bd);
                    if (gap < minimumGap) { minimumGap = gap; closestPair = names[i] + " / " + names[j]; }
                }
            }
            Check(minimumGap >= DisplayLayout.Spacing - .0001f,
                "river separation: " + snapshot.roundLabel + ", " + columns + " columns, " + closestPair + ", gap " + minimumGap);
        }

        private static void CheckRoundEffects(FixtureScenarios scenarios, int beforeCase, int afterCase)
        {
            var session = new DisplaySession();
            Check(session.Apply(scenarios.Snapshot(beforeCase, 41)), "initial round snapshot");
            var ended = scenarios.Snapshot(beforeCase, 42, "roundEnd");
            Check(session.Apply(ended) && session.Effect == ended.effect, "committed round end appears once");
            var carried = scenarios.Snapshot(afterCase, 43, "roundEnd");
            carried.effect.id = ended.effect.id;
            Check(session.Apply(carried) && session.Animate && session.Effect == null,
                "round change must not replay the same committed effect id");
            var fresh = scenarios.Snapshot(afterCase, 44, "riichi");
            Check(session.Apply(fresh) && session.Effect == fresh.effect, "fresh effect in the new round appears");

            var boundary = new DisplaySession();
            boundary.Apply(scenarios.Snapshot(beforeCase, 41));
            var freshBoundary = scenarios.Snapshot(afterCase, 42, "pon");
            Check(boundary.Apply(freshBoundary) && boundary.Animate && boundary.Effect == freshBoundary.effect,
                "round change permits a fresh committed effect");

            var restored = new DisplaySession();
            Check(restored.Apply(ended, true) && !restored.Animate && restored.Effect == null, "restore suppresses round end history");
            Check(restored.Apply(carried) && restored.Effect == null, "restored id stays suppressed across the round boundary");
            var restoreInPlace = scenarios.Snapshot(afterCase, 44, "kita");
            Check(restored.Apply(restoreInPlace, true) && !restored.Animate && restored.Effect == null, "in-place restore suppresses new history");
            var repeated = scenarios.Snapshot(afterCase, 45, "kita");
            repeated.effect.id = restoreInPlace.effect.id;
            Check(restored.Apply(repeated) && restored.Effect == null, "in-place restore records the effect id");

            var otherRoom = scenarios.Snapshot(beforeCase, 0); otherRoom.roomId = "other";
            Check(session.Apply(otherRoom) && !session.Animate && session.Effect == null, "room change resets version and suppresses history");
            var reused = scenarios.Snapshot(afterCase, 1, "roundEnd"); reused.roomId = "other"; reused.effect.id = ended.effect.id;
            Check(session.Apply(reused) && session.Effect == reused.effect, "effect ids are scoped to the room session");
        }

        public static int Run(ContractFixture contract)
        {
            checks = 0;
            var scenarios = new FixtureScenarios(contract);
            Check(scenarios.Cases.Count == 12, "all rotation/progression before/after states");
            Check(scenarios.DrawDurationMs == 200, "fixture draw entrance duration");
            var benched = new HashSet<string>();
            for (int i = 0; i < scenarios.Cases.Count; i++)
            {
                var snapshot = scenarios.Snapshot(i, i);
                DisplayValidation.Validate(snapshot);
                var source = scenarios.Cases[i];
                foreach (var slot in snapshot.slots)
                {
                    if (slot.bench) benched.Add(slot.playerId);
                    Check(slot.seatWind == source.seats.WindFor(slot.playerId), "supplied seat assignment preserved");
                    if (source.points != null) Check(slot.points == source.points.For(slot.playerId), "points follow player id");
                    Check(slot.position == "self" || (slot.hand.Length == 0 && slot.drawn == null), "hidden opponents");
                }
                foreach (int columns in new[] { 4, 6 })
                {
                    CheckRiverSeparation(snapshot, columns);
                    CheckRiverSeparation(scenarios.Snapshot(i, i + 1, "discard"), columns);
                }
            }
            Check(benched.Count == 4, "every player has a bench case");
            foreach (var kind in DisplayValidation.EffectKinds)
                Check(scenarios.Snapshot(0, 50, kind).effect.kind == kind, "effect sample " + kind);
            foreach (var visual in contract.visualCases)
            {
                if (visual.id == "major-effects")
                    foreach (var kind in visual.assertions.kinds)
                        Check(Array.IndexOf(DisplayValidation.EffectKinds, kind) >= 0, "all contract effects supported");
                if (visual.id == "hand-deal-draw-replacement-meld")
                    foreach (var kind in visual.assertions.transitionKinds)
                        Check(Array.IndexOf(DisplayValidation.TransitionKinds, kind) >= 0, "all contract transitions supported");
            }

            var state = new DisplaySession();
            foreach (var step in contract.source.snapshotVersionSequence)
            {
                var before = state.Current;
                bool applied = state.Apply(scenarios.Snapshot(0, step.version, "riichi"));
                Check(applied == (step.expected == "apply"), "version sequence " + step.version);
                if (!applied) Check(ReferenceEquals(before, state.Current), "stale input leaves view unchanged");
            }
            Check(state.Current.version == 43, "latest version retained");
            var restored = new DisplaySession();
            Check(restored.Apply(state.Current, true), "reload current snapshot");
            Check(!restored.Animate && restored.Effect == null, "reload suppresses history");
            var duplicateEffect = scenarios.Snapshot(0, 44, "riichi");
            duplicateEffect.effect.id = state.Current.effect.id;
            Check(restored.Apply(duplicateEffect) && restored.Effect == null, "event id is deduplicated after reload");
            var fresh = scenarios.Snapshot(0, 45, "ron");
            Check(restored.Apply(fresh) && restored.Effect.kind == "ron", "new committed effect appears");
            var otherRoom = scenarios.Snapshot(0, 0, "ron"); otherRoom.roomId = "other";
            Check(restored.Apply(otherRoom) && !restored.Animate && restored.Effect == null, "room switch resets watermark and suppresses history");
            var restoreInPlace = scenarios.Snapshot(0, 1, "tsumo"); restoreInPlace.roomId = "other";
            Check(restored.Apply(restoreInPlace, true) && !restored.Animate && restored.Effect == null, "explicit fresh-version restore suppresses effects");
            for (int i = contract.rotationCases.Length * 2; i < scenarios.Cases.Count; i += 2)
                CheckRoundEffects(scenarios, i, i + 1);

            var river = scenarios.Snapshot(0, 1).slots[0].river;
            foreach (int columns in new[] { 4, 6 })
            {
                var positions = DisplayLayout.River(river, columns);
                Check(positions.Length == river.Length, "no river tiles dropped");
                for (int i = 0; i < river.Length; i++)
                {
                    Near(positions[i].yaw, river[i].sideways ? 90 : 0, "reach orientation");
                    Near(positions[i].z, -(i / columns) * .47f, "row wrap");
                    if (i % columns == 0) continue;
                    float leftHalf = river[i - 1].sideways ? .21f : .15f;
                    float rightHalf = river[i].sideways ? .21f : .15f;
                    Check(positions[i].x - rightHalf >= positions[i - 1].x + leftHalf + .049f, "no overlap beside sideways reach");
                }
            }
            Reject(() => DisplayLayout.River(river, 0), "invalid columns");
            Near(DisplayLayout.HandX(13, 14, true) - DisplayLayout.HandX(12, 14, false), .63f, "separate drawn tile gap");
            Near(DisplayLayout.SeatYaw("self"), 0, "self orientation");
            Near(DisplayLayout.SeatYaw("left"), 90, "left orientation");
            Near(DisplayLayout.SeatYaw("across"), 180, "across orientation");
            Near(DisplayLayout.SeatYaw("right"), 270, "right orientation");
            Check(scenarios.Snapshot(0, 1, null, "meld").slots[0].drawn == null, "meld removes drawn tile");
            Check(scenarios.Snapshot(0, 1, null, "replacement").slots[0].drawn.label == "N", "replacement sample");
            Check(scenarios.Snapshot(0, 1, "kita").slots[0].northCount == 1, "north extraction display");

            var validState = new DisplaySession(); validState.Apply(scenarios.Snapshot(0, 10));
            var bad = scenarios.Snapshot(0, 100); bad.schemaVersion = 2;
            Reject(() => validState.Apply(bad), "schema");
            Check(validState.Current.version == 10, "invalid input cannot advance watermark");
            bad = scenarios.Snapshot(0, 11); bad.slots[1].seatWind = "east";
            Reject(() => validState.Apply(bad), "bench wind");
            bad = scenarios.Snapshot(0, 11); bad.slots[2].hand = bad.slots[0].hand;
            Reject(() => validState.Apply(bad), "opponent privacy");
            bad = scenarios.Snapshot(0, 11); bad.slots[2].playerId = bad.slots[0].playerId;
            Reject(() => validState.Apply(bad), "duplicate player");
            bad = scenarios.Snapshot(0, 11); bad.slots[2].position = "self";
            Reject(() => validState.Apply(bad), "duplicate position");
            bad = scenarios.Snapshot(0, 11); bad.slots[0].river[0] = null;
            Reject(() => validState.Apply(bad), "null tile");
            bad = scenarios.Snapshot(0, 11); bad.slots[1].northCount = 1;
            Reject(() => validState.Apply(bad), "bench north tiles");
            Check(validState.Apply(scenarios.Snapshot(0, 11)), "valid input after rejected high watermark");
            return checks;
        }
    }
}
