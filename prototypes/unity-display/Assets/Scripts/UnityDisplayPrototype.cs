using System;
using System.Collections;
using UnityEngine;

namespace FourBros.Display
{
    public sealed class UnityDisplayPrototype : MonoBehaviour
    {
        public TextAsset fixture;
        public OptionalModelAssets optionalAssets;
        public Material tileMaterial, backMaterial, tableMaterial;
        private FixtureScenarios scenarios;
        private DisplaySession session = new DisplaySession();
        private Transform board;
        private Camera displayCamera;
        private Font font;
        private int caseIndex, columns = 6;
        private long nextVersion = 41;
        private string status = "", effectText = "";
        private float effectUntil, effectStart;
        private Vector2 scroll;
        private bool tilted;

        private void Start()
        {
            try
            {
                if (fixture == null) throw new ArgumentException("Run Four Bros / Build display scene first");
                scenarios = new FixtureScenarios(JsonUtility.FromJson<ContractFixture>(fixture.text));
                font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                displayCamera = Camera.main;
                Apply(scenarios.Snapshot(caseIndex, nextVersion++));
            }
            catch (Exception error) { status = error.Message; Debug.LogException(error); enabled = false; }
        }

        // Future transport adapters supply an already committed view. No credentials or domain state accepted.
        public bool Apply(DisplaySnapshot snapshot, bool restore = false)
        {
            var previous = session.Current;
            if (!session.Apply(snapshot, restore)) { status = "Ignored stale/duplicate v" + snapshot.version; return false; }
            StopAllCoroutines();
            effectText = "";
            Render(previous, session.Animate);
            if (session.Effect != null)
            {
                effectText = session.Effect.kind.ToUpperInvariant() + "  " + session.Effect.playerId;
                effectStart = Time.unscaledTime;
                effectUntil = effectStart + 1.4f;
            }
            status = "Applied v" + snapshot.version + (session.Animate ? " / live" : " / restored, no historical cues");
            return true;
        }

        private void Render(DisplaySnapshot previous, bool animate)
        {
            if (board != null) { board.gameObject.SetActive(false); Destroy(board.gameObject); }
            board = new GameObject("Display snapshot v" + session.Current.version).transform;
            board.SetParent(transform, false);
            Visual("table", board, new Vector3(0, -.32f, 0), new Vector3(10, .4f, 10), tableMaterial);
            foreach (var slot in session.Current.slots)
            {
                var seat = new GameObject(slot.position + ":" + slot.playerId).transform;
                seat.SetParent(board, false);
                seat.localRotation = Quaternion.Euler(0, DisplayLayout.SeatYaw(slot.position), 0);
                seat.localPosition = seat.localRotation * new Vector3(0, 0, -3.0f);
                Label(seat, slot.playerId + "  " + slot.points + "\n" + (slot.bench ? "BENCH (no wind)" : slot.seatWind + " / north " + slot.northCount),
                    new Vector3(0, .12f, -1.45f), .17f, Color.white);
                if (optionalAssets != null && optionalAssets.character != null)
                {
                    var marker = new GameObject("Character anchor").transform;
                    marker.SetParent(seat, false); marker.localPosition = new Vector3(2.7f, 0, -.2f);
                    optionalAssets.CreateVisual("character", marker);
                }
                if (slot.bench) continue;
                var river = DisplayLayout.RiverOnBoard(slot.river, slot.position, columns);
                SlotDisplay oldSlot = null;
                if (previous != null && previous.roomId == session.Current.roomId && previous.roundLabel == session.Current.roundLabel)
                    foreach (var old in previous.slots) if (old.playerId == slot.playerId) oldSlot = old;
                bool appended = animate && IsSingleAppend(oldSlot, slot);
                for (int i = 0; i < river.Length; i++)
                {
                    var p = river[i];
                    var tile = DrawTile(board, slot.river[i], new Vector3(p.x, .08f, p.z), p.yaw);
                    if (appended && i == river.Length - 1) StartCoroutine(Enter(tile, 0, false, DisplayLayout.SeatYaw(slot.position)));
                }
                int count = slot.hand.Length > 0 ? slot.hand.Length : slot.concealedCount;
                int total = count + (slot.drawn == null ? 0 : 1);
                for (int i = 0; i < count; i++)
                {
                    var face = slot.hand.Length > 0 ? slot.hand[i] : null;
                    var tile = DrawTile(seat, face, new Vector3(DisplayLayout.HandX(i, total, false), .08f, -.8f), 0);
                    if (animate && face != null && session.Current.handTransition == "deal") StartCoroutine(Enter(tile, i * .025f, false));
                    if (animate && face != null && session.Current.handTransition == "meld") StartCoroutine(Enter(tile, 0, true));
                }
                if (slot.drawn != null)
                {
                    var tile = DrawTile(seat, slot.drawn, new Vector3(DisplayLayout.HandX(count, total, true), .08f, -.8f), 0);
                    if (animate && (session.Current.handTransition == "draw" || session.Current.handTransition == "replacement")) StartCoroutine(Enter(tile, 0, false));
                }
            }
            Label(board, session.Current.roundLabel, new Vector3(0, .15f, 0), .14f, Color.white);
        }

        private static bool IsSingleAppend(SlotDisplay previous, SlotDisplay current)
        {
            if (previous == null || previous.bench || previous.river.Length + 1 != current.river.Length) return false;
            for (int i = 0; i < previous.river.Length; i++)
            {
                var a = previous.river[i]; var b = current.river[i];
                if (a.label != b.label || a.red != b.red || a.sideways != b.sideways) return false;
            }
            return true;
        }

        private Transform DrawTile(Transform parent, TileDisplay data, Vector3 position, float yaw)
        {
            var root = new GameObject(data == null ? "Concealed" : data.label + (data.sideways ? " reach" : "")).transform;
            root.SetParent(parent, false); root.localPosition = position; root.localRotation = Quaternion.Euler(0, yaw, 0);
            // Concealed tiles always use blank built-in backs; optional models may contain visible faces.
            Visual(data == null ? "back" : "tile", root, Vector3.zero,
                new Vector3(DisplayLayout.TileWidth, DisplayLayout.TileHeight, DisplayLayout.TileDepth), data == null ? backMaterial : tileMaterial);
            if (data != null) Label(root, data.label, new Vector3(0, .09f, 0), .16f, data.red ? new Color(.8f, .08f, .08f) : Color.black);
            return root;
        }

        private void Visual(string kind, Transform parent, Vector3 position, Vector3 size, Material material)
        {
            var anchor = new GameObject(kind).transform;
            anchor.SetParent(parent, false); anchor.localPosition = position; anchor.localScale = size;
            var custom = kind != "back" && optionalAssets != null ? optionalAssets.CreateVisual(kind, anchor) : null;
            if (custom != null) return;
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.transform.SetParent(anchor, false);
            cube.GetComponent<Renderer>().sharedMaterial = material;
            Destroy(cube.GetComponent<Collider>());
        }

        private void Label(Transform parent, string text, Vector3 position, float scale, Color color)
        {
            var label = new GameObject("Label").AddComponent<TextMesh>();
            label.transform.SetParent(parent, false); label.transform.localPosition = position;
            label.transform.localRotation = Quaternion.Euler(90, 0, 0);
            label.font = font; label.fontSize = 48; label.characterSize = scale;
            label.anchor = TextAnchor.MiddleCenter; label.alignment = TextAlignment.Center;
            label.color = color; label.text = text;
            label.GetComponent<Renderer>().sharedMaterial = font.material;
        }

        private IEnumerator Enter(Transform tile, float delay, bool slide, float seatYaw = 0)
        {
            Vector3 target = tile.localPosition;
            Vector3 offset = slide ? Vector3.right * .2f : new Vector3(0, .3f, -.25f);
            offset = Quaternion.Euler(0, seatYaw, 0) * offset;
            tile.localPosition = target + offset;
            float start = Time.unscaledTime + delay;
            while (Time.unscaledTime < start) yield return null;
            float duration = scenarios.DrawDurationMs / 1000f;
            while (Time.unscaledTime - start < duration)
            {
                float t = Mathf.Clamp01((Time.unscaledTime - start) / duration);
                tile.localPosition = Vector3.Lerp(target + offset, target, t * t * (3 - 2 * t));
                yield return null;
            }
            tile.localPosition = target;
        }

        private void LateUpdate()
        {
            if (displayCamera == null) return;
            float panel = Mathf.Min(330f, Screen.width * .4f);
            displayCamera.rect = new Rect(panel / Screen.width, 0, 1 - panel / Screen.width, 1);
            displayCamera.orthographicSize = Mathf.Max(6.2f, 6.2f / displayCamera.aspect);
            displayCamera.transform.position = tilted ? new Vector3(0, 13, -7) : new Vector3(0, 15, 0);
            displayCamera.transform.rotation = tilted ? Quaternion.LookRotation(-displayCamera.transform.position, Vector3.up) : Quaternion.Euler(90, 0, 0);
        }

        private void OnGUI()
        {
            float width = Mathf.Min(330f, Screen.width * .4f);
            GUILayout.BeginArea(new Rect(8, 8, width - 16, Screen.height - 16), GUI.skin.box);
            scroll = GUILayout.BeginScrollView(scroll);
            GUILayout.Label("Four Bros / Unity display #818\nFIXTURE ONLY - not a game client");
            GUILayout.Label(status);
            if (scenarios != null)
            {
                GUILayout.Label(scenarios.Cases[caseIndex].name);
                for (int i = 0; i < scenarios.Cases.Count; i++)
                {
                    int selected = i;
                    if (GUILayout.Button(scenarios.Cases[i].name))
                    {
                        caseIndex = selected;
                        Apply(scenarios.Snapshot(caseIndex, nextVersion++));
                    }
                }
                GUILayout.Label("Committed effect samples (includes kita)");
                foreach (var kind in DisplayValidation.EffectKinds)
                    if (GUILayout.Button(kind)) Apply(scenarios.Snapshot(caseIndex, nextVersion++, kind));
                GUILayout.Label("Self hand transitions (select a seated self case)");
                foreach (var kind in DisplayValidation.TransitionKinds)
                    if (GUILayout.Button(kind)) Apply(scenarios.Snapshot(caseIndex, nextVersion++, null, kind));
                if (GUILayout.Button("Restore current snapshot / suppress history"))
                {
                    var saved = JsonUtility.FromJson<DisplaySnapshot>(JsonUtility.ToJson(session.Current));
                    session = new DisplaySession(); Apply(saved, true);
                }
                if (GUILayout.Button("Replay fixture version sequence")) ReplayVersions();
                if (GUILayout.Button("River wrap: " + columns + " columns"))
                {
                    columns = columns == 6 ? 4 : 6; StopAllCoroutines(); Render(null, false);
                }
                tilted = GUILayout.Toggle(tilted, "Tilt camera (3D inspection)");
            }
            GUILayout.EndScrollView(); GUILayout.EndArea();
            if (Time.unscaledTime < effectUntil && !string.IsNullOrEmpty(effectText))
            {
                float pulse = 1 + .15f * Mathf.Sin(Mathf.Clamp01((Time.unscaledTime - effectStart) / .3f) * Mathf.PI);
                var style = new GUIStyle(GUI.skin.box) { fontSize = Mathf.RoundToInt(28 * pulse), alignment = TextAnchor.MiddleCenter };
                GUI.Box(new Rect(width + 20, 20, Screen.width - width - 40, 70), effectText, style);
            }
        }

        private void ReplayVersions()
        {
            session = new DisplaySession();
            string summary = "";
            foreach (var step in scenarios.Contract.source.snapshotVersionSequence)
            {
                bool applied = Apply(scenarios.Snapshot(caseIndex, step.version, "riichi"));
                summary += step.version + ":" + (applied ? "apply" : "ignore") + " ";
                if (applied != (step.expected == "apply")) throw new InvalidOperationException("Fixture version mismatch");
            }
            nextVersion = Math.Max(nextVersion, session.Current.version + 1);
            status = summary;
            Debug.Log("#818 sequence: " + summary);
        }
    }
}
