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
