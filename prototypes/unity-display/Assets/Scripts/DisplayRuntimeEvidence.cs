using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Profiling;

namespace FourBros.Display
{
    // Opt-in standalone verification; shares the exact commands used by the IMGUI buttons.
    // Captures actual rendered frames, not a second implementation of the renderer.
    public sealed class DisplayRuntimeEvidence : MonoBehaviour
    {
        [Serializable] private sealed class Evidence
        {
            public string recordedAtUtc, unityVersion, operatingSystem, processor, graphicsDevice, graphicsApi;
            public int width, height, systemMemoryMB, assertions, frameSamples, vSyncCount, targetFrameRate;
            public bool developmentBuild, passed;
            public float frameMedianMs, frameP95Ms, applyMedianMs, applyP95Ms, actionToEndOfFrameMedianMs, actionToEndOfFrameP95Ms;
            public long allocatedMemoryBytes, reservedMemoryBytes, managedMemoryBytes;
            public string latencyScope = "Synthetic IMGUI command handler to CPU end-of-frame; excludes physical input and display scanout.";
            public string[] screenshots, errors;
        }

        private UnityDisplayPrototype display;
        private string output;
        private readonly List<string> screenshots = new List<string>();
        private readonly List<string> errors = new List<string>();
        private readonly Evidence evidence = new Evidence();

        internal static void AbortIfRequested()
        {
            // A fixture/initial render failure precedes TryStart. Do not leave automation hanging.
            if (!Application.isEditor && Array.IndexOf(Environment.GetCommandLineArgs(), "-displayEvidence") >= 0)
                Application.Quit(1);
        }

        internal static void TryStart(UnityDisplayPrototype display)
        {
            var args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, "-displayEvidence");
            if (index < 0) return;
            if (Application.isEditor || index + 1 >= args.Length || !Path.IsPathRooted(args[index + 1]))
                throw new ArgumentException("-displayEvidence requires a standalone player and an absolute output directory");
            if (Directory.Exists(args[index + 1]) && Directory.GetFileSystemEntries(args[index + 1]).Length != 0)
                throw new ArgumentException("Use an empty evidence directory to keep runs separate");
            var runner = display.gameObject.AddComponent<DisplayRuntimeEvidence>();
            runner.display = display;
            runner.output = args[index + 1];
            Directory.CreateDirectory(runner.output);
            Application.logMessageReceived += runner.OnLog;
            runner.StartCoroutine(runner.GuardedRun());
        }

        private void OnLog(string condition, string stack, LogType type)
        {
            if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert)
                errors.Add(condition + "\n" + stack);
        }

        private IEnumerator GuardedRun()
        {
            var run = Run();
            while (true)
            {
                object next;
                try
                {
                    if (!run.MoveNext()) break;
                    next = run.Current;
                }
                catch (Exception error) { errors.Add(error.ToString()); break; }
                yield return next;
            }
            evidence.screenshots = screenshots.ToArray();
            evidence.errors = errors.ToArray();
            evidence.passed = errors.Count == 0;
            int exitCode = 1;
            try
            {
                File.WriteAllText(Path.Combine(output, "runtime-evidence.json"), JsonUtility.ToJson(evidence, true));
                exitCode = evidence.passed ? 0 : 1;
                Debug.Log("#818 runtime evidence " + (evidence.passed ? "PASS" : "FAIL") + ": " + output);
            }
            catch (Exception error) { Debug.LogException(error); }
            finally
            {
                Application.logMessageReceived -= OnLog;
                Application.Quit(exitCode);
            }
        }

        private void Check(bool condition, string message)
        {
            evidence.assertions++;
            if (!condition) throw new InvalidOperationException(message);
        }

        private IEnumerator Run()
        {
            Application.runInBackground = true;
            evidence.recordedAtUtc = DateTime.UtcNow.ToString("O");
            evidence.unityVersion = Application.unityVersion;
            evidence.operatingSystem = SystemInfo.operatingSystem;
            evidence.processor = SystemInfo.processorType;
            evidence.graphicsDevice = SystemInfo.graphicsDeviceName;
            evidence.graphicsApi = SystemInfo.graphicsDeviceType.ToString();
            evidence.systemMemoryMB = SystemInfo.systemMemorySize;
            evidence.developmentBuild = Debug.isDebugBuild;
            evidence.vSyncCount = QualitySettings.vSyncCount;
            evidence.targetFrameRate = Application.targetFrameRate;
            yield return new WaitForSecondsRealtime(1);
            evidence.width = Screen.width; evidence.height = Screen.height;
            foreach (int columns in new[] { 6, 4 })
            {
                display.SetColumns(columns);
                for (int i = 0; i < display.Scenarios.Cases.Count; i++)
                {
                    display.SelectCase(i);
                    yield return new WaitForEndOfFrame();
                    CheckScene(columns);
                    Capture("case-" + i.ToString("00") + "-columns-" + columns);
                    string saved = JsonUtility.ToJson(display.Current);
                    display.RestoreCurrent();
                    Check(JsonUtility.ToJson(display.Current) == saved, "restore all rotation/progression values");
                    Check(display.Current.effect == null && display.Current.handTransition == null, "restore preserves absent effect/transition");
                    yield return new WaitForEndOfFrame();
                    CheckScene(columns);
                }
            }
            display.SetColumns(6); display.SelectCase(0);
            foreach (string kind in DisplayValidation.EffectKinds)
            {
                display.ShowEffect(kind);
                Check(display.ActiveEffect.StartsWith(kind.ToUpperInvariant(), StringComparison.Ordinal), "effect banner " + kind);
                yield return new WaitForEndOfFrame();
                Capture("effect-" + kind);
            }
            foreach (string kind in DisplayValidation.TransitionKinds)
            {
                display.ShowTransition(kind);
                var self = display.Board.Find("self:" + display.Current.slots[0].playerId);
                int movingIndex = kind == "draw" || kind == "replacement" ? self.childCount - 1 : 1;
                Transform movingTile = self.GetChild(movingIndex);
                Vector3 entryPosition = movingTile.localPosition;
                yield return new WaitForEndOfFrame();
                Capture("transition-" + kind + "-entry");
                yield return new WaitForSecondsRealtime(.65f);
                yield return new WaitForEndOfFrame();
                CheckScene(6);
                Check(Vector3.Distance(entryPosition, movingTile.localPosition) > .1f, "hand transition moved " + kind);
                Capture("transition-" + kind + "-settled");
            }
            display.ShowEffect("kita");
            string before = JsonUtility.ToJson(display.Current);
            display.RestoreCurrent();
            Check(JsonUtility.ToJson(display.Current) == before, "JsonUtility restore preserves current snapshot");
            Check(display.ActiveEffect == "", "restore suppresses historical effect");
            yield return new WaitForEndOfFrame();
            CheckScene(6); Capture("restored-kita");
            display.ReplayVersions();
            Check(display.Status == "41:apply 42:apply 41:ignore 42:ignore 43:apply ", "version replay result");
            yield return new WaitForEndOfFrame();
            Capture("version-sequence");
            display.SelectCase(0); display.SetTilt(true);
            yield return new WaitForEndOfFrame(); Capture("tilted");
            display.SetTilt(false);

            // Measure after capture/encoding and deferred destruction have settled.
            yield return new WaitForSecondsRealtime(1);
            var frames = new List<float>();
            for (int i = 0; i < 180; i++)
            {
                yield return null;
                frames.Add(Time.unscaledDeltaTime * 1000);
            }
            evidence.frameSamples = frames.Count;
            evidence.frameMedianMs = Percentile(frames, .5f); evidence.frameP95Ms = Percentile(frames, .95f);
            var apply = new List<float>(); var feedback = new List<float>();
            for (int i = 0; i < 30; i++)
            {
                double start = Time.realtimeSinceStartupAsDouble;
                display.SelectCase(i % display.Scenarios.Cases.Count);
                apply.Add((float)((Time.realtimeSinceStartupAsDouble - start) * 1000));
                yield return new WaitForEndOfFrame();
                feedback.Add((float)((Time.realtimeSinceStartupAsDouble - start) * 1000));
                yield return null;
            }
            evidence.applyMedianMs = Percentile(apply, .5f); evidence.applyP95Ms = Percentile(apply, .95f);
            evidence.actionToEndOfFrameMedianMs = Percentile(feedback, .5f);
            evidence.actionToEndOfFrameP95Ms = Percentile(feedback, .95f);
            evidence.allocatedMemoryBytes = Profiler.GetTotalAllocatedMemoryLong();
            evidence.reservedMemoryBytes = Profiler.GetTotalReservedMemoryLong();
            evidence.managedMemoryBytes = Profiler.GetMonoUsedSizeLong();
        }

        private void CheckScene(int columns)
        {
            var board = display.Board;
            Check(board != null && board.gameObject.activeInHierarchy, "current board active");
            int expectedRiverCount = 0;
            var actualRiver = new List<Transform>();
            foreach (Transform child in board)
                if (child.Find("tile") != null) actualRiver.Add(child);
            foreach (var slot in display.Current.slots)
            {
                var seat = board.Find(slot.position + ":" + slot.playerId);
                Check(seat != null, "physical slot " + slot.position);
                string label = seat.Find("Label").GetComponent<TextMesh>().text;
                Check(label.Contains(slot.points.ToString()), "points follow player " + slot.playerId);
                Check(label.Contains(slot.bench ? "BENCH (no wind)" : slot.seatWind), "wind/bench label");
                int faces = 0, backs = 0;
                foreach (Transform child in seat)
                {
                    if (child.Find("tile") != null) faces++;
                    if (child.Find("back") != null) backs++;
                }
                Check(faces == slot.hand.Length + (slot.drawn == null ? 0 : 1), "visible hand count");
                Check(backs == slot.concealedCount, "concealed hand count");
                var placements = DisplayLayout.RiverOnBoard(slot.river, slot.position, columns);
                for (int i = 0; i < placements.Length; i++)
                {
                    var tile = actualRiver[expectedRiverCount++];
                    var p = placements[i];
                    Check(Vector3.Distance(tile.localPosition, new Vector3(p.x, .08f, p.z)) < .0001f, "rendered river position");
                    Check(Mathf.Abs(Mathf.DeltaAngle(tile.localEulerAngles.y, p.yaw)) < .001f, "rendered reach/seat orientation");
                    var textBounds = tile.Find("Label").GetComponent<Renderer>().bounds;
                    var tileBounds = tile.Find("tile").GetComponentInChildren<Renderer>().bounds;
                    Check(textBounds.size.x <= tileBounds.size.x && textBounds.size.z <= tileBounds.size.z,
                        "river text fits its physical tile");
                }
            }
            Check(actualRiver.Count == expectedRiverCount, "all river tiles rendered exactly once");
        }

        private void Capture(string name)
        {
            var texture = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
            try
            {
                texture.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0);
                texture.Apply();
                File.WriteAllBytes(Path.Combine(output, name + ".png"), texture.EncodeToPNG());
                screenshots.Add(name + ".png");
            }
            finally { Destroy(texture); }
        }

        private static float Percentile(List<float> values, float percentile)
        {
            values.Sort();
            return values[Mathf.Clamp(Mathf.CeilToInt(values.Count * percentile) - 1, 0, values.Count - 1)];
        }
    }
}
