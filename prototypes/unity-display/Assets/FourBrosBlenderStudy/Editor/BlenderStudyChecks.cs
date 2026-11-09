using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace FourBros.BlenderStudy
{
    /// <summary>Actual FBX imports and GPU captures, invoked with -executeMethod. No mock renderer.</summary>
    public static class BlenderStudyChecks
    {
        private const string Root = "Assets/FourBrosBlenderStudy";
        private static readonly string[] Names = { "MahjongTable", "TilePin5", "SoakuhinStudy" };
        private static readonly int[] MeshCounts = { 18, 12, 86 };
        private static readonly int[] TriangleCounts = { 1656, 2056, 11228 };
        // Metres, converted from the Blender manifest's (X,Y,Z) into Unity (X,Z,Y).
        private static readonly Vector3[] Sizes = {
            new Vector3(.94f, .7795f, .94f),
            new Vector3(.026f, .0185397118f, .036f),
            new Vector3(.776165426f, 1.804539768f, .305f)
        };

        [Serializable] private sealed class ModelRecord
        {
            public string name, guid, prefabGuid, geometrySha256, sourceFbxSha256;
            public Vector3 position, rotation, scale, boundsSize, boundsMin, conservativeMeshBoundsSize;
            public Vector3[] characterLandmarks;
            public int meshes, triangles, vertices, uvMeshes, normalMeshes;
            public string[] materialPaths;
        }
        [Serializable] private sealed class MaterialRecord
        {
            public string name;
            public Color color;
            public float metallic, glossiness;
        }
        [Serializable] private sealed class CaptureRecord
        {
            public string file, sha256;
        }
        [Serializable] private sealed class Report
        {
            public int schemaVersion = 1;
            public string recordedAtUtc, unityVersion, operatingSystem, processor, graphicsDevice, graphicsApi;
            public string validation = "Unity Editor FBX import, GPU render and scripted controller checks";
            public string interaction = "Controller methods used by Update; physical mouse/keyboard input not exercised";
            public string performanceScope = "Editor Camera.Render CPU wall time; excludes presentation, GPU completion and player FPS";
            public string[] checks;
            public CaptureRecord[] captures;
            public ModelRecord[] baseline, revision;
            public MaterialRecord[] baselineMaterials, revisionMaterials;
            public Color baselineFelt, revisionFelt;
            public int renderWidth = 960, renderHeight = 540, renderSamples;
            public double renderCpuMedianMilliseconds, renderCpuP95Milliseconds;
            public long totalAllocatedMemoryBytes;
        }

        [MenuItem("FourBros/Blender Study/5 Validate imports and capture evidence")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Exit Play mode before validating imported assets.");
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
                throw new InvalidOperationException("GPU validation requires graphics: do not pass -nographics.");
            var output = OutputDirectory();
            // A fresh directory prevents accidentally overwriting prior evidence.
            if (Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
                throw new IOException("Choose an empty -blenderStudyReportDir: " + output);
            Directory.CreateDirectory(output);
            var report = new Report {
                recordedAtUtc = DateTime.UtcNow.ToString("o"), unityVersion = Application.unityVersion,
                operatingSystem = SystemInfo.operatingSystem, processor = SystemInfo.processorType,
                graphicsDevice = SystemInfo.graphicsDeviceName, graphicsApi = SystemInfo.graphicsDeviceType.ToString()
            };
            var previousScenes = EditorSceneManager.GetSceneManagerSetup();
            // Validation needs only the preview scene; an unsaved user's scene must not be discarded.
            for (var i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Save open scenes before running asset validation.");
            try
            {
                BlenderAssetStudy.ImportBaseline();
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                BlenderAssetStudy.BuildScene();
                report.baseline = Snapshot();
                report.baselineMaterials = Materials();
                report.baselineFelt = FeltColor();
                var camera = GameObject.Find("Preview camera").GetComponent<Camera>();
                var controller = camera.GetComponent<BlenderStudyCamera>();
                Capture(camera, Path.Combine(output, "unity-baseline.png"), 960, 540);

                var startCamera = camera.transform.position;
                controller.Orbit(12, -4);
                Require(Vector3.Distance(startCamera, camera.transform.position) > .1f, "Orbit changes camera");
                var orbited = camera.transform.position;
                controller.Zoom(2);
                Require(Vector3.Distance(orbited, camera.transform.position) > .1f, "Zoom changes camera");
                controller.InitializeTile();
                var tileStart = controller.tile.position;
                controller.ToggleTileMovement();
                controller.AdvanceTileMovement(.1f);
                Require(Vector3.Distance(controller.tile.position, tileStart + Vector3.right * .08f) < .00001f,
                    "Tile moves halfway at 100 ms");
                controller.AdvanceTileMovement(.1f);
                Require(Vector3.Distance(controller.tile.position, tileStart + Vector3.right * .16f) < .00001f,
                    "Tile arrives at 200 ms");
                controller.FocusTile();
                Capture(camera, Path.Combine(output, "unity-tile-moved.png"), 1920, 1080);
                controller.ToggleTileMovement();
                controller.AdvanceTileMovement(.2f);
                Require(Vector3.Distance(controller.tile.position, tileStart) < .00001f, "Tile returns");
                controller.FocusTile();
                Require(Mathf.Abs(Vector3.Distance(camera.transform.position, controller.tile.position) - .6f) < .00001f,
                    "Tile focus uses a 0.6 metre distance");
                Capture(camera, Path.Combine(output, "unity-tile-detail.png"), 1920, 1080);
                controller.ResetInitialView();
                Require(Vector3.Distance(camera.transform.position, startCamera) < .00001f, "Camera returns to initial view");

                BlenderAssetStudy.ImportRevision();
                report.revision = Snapshot();
                report.revisionMaterials = Materials();
                report.revisionFelt = FeltColor();
                Require(report.baselineFelt != report.revisionFelt, "Felt color changes");
                Require(report.baselineMaterials.Length == report.revisionMaterials.Length, "Material set size retained");
                for (var i = 0; i < report.baselineMaterials.Length; i++)
                {
                    var before = report.baselineMaterials[i];
                    var after = report.revisionMaterials[i];
                    Require(before.name == after.name && before.metallic == after.metallic && before.glossiness == after.glossiness,
                        "Material identity and surface parameters retained: " + before.name);
                    Require(before.name == "Felt" ? before.color != after.color : before.color == after.color,
                        "Only Felt changes color: " + before.name);
                }
                for (var i = 0; i < Names.Length; i++)
                {
                    var before = report.baseline[i];
                    var after = report.revision[i];
                    Require(before.guid == after.guid && before.prefabGuid == after.prefabGuid, "GUID/reference retained: " + Names[i]);
                    Require(before.position == after.position && before.rotation == after.rotation && before.scale == after.scale,
                        "Instance transform retained: " + Names[i]);
                    Require(before.geometrySha256 == after.geometrySha256, "Geometry/UV/normals retained: " + Names[i]);
                    Require(before.materialPaths.SequenceEqual(after.materialPaths), "Material references retained: " + Names[i]);
                }
                Capture(camera, Path.Combine(output, "unity-revision.png"), 960, 540);
                MeasureRender(camera, report);
                report.totalAllocatedMemoryBytes = Profiler.GetTotalAllocatedMemoryLong();
                report.checks = new[] {
                    "6 FBX imported; mesh/triangle counts, metre dimensions, UVs and normals verified",
                    "All renderer materials reference external Standard materials",
                    "Baseline to revision keeps model GUIDs, prefab references, transforms, geometry, UVs and normals",
                    "Only Felt changes color; material references, metallic and glossiness retained",
                    "Nose and asymmetric chest crest prove Blender X/Z/Y maps to Unity X/Y/Z",
                    "Orbit, zoom, tile focus, 100/200 ms movement and return executed through runtime controller methods",
                    "4 GPU-rendered PNGs contain non-uniform image data"
                };
                report.captures = new[] { "unity-baseline.png", "unity-revision.png", "unity-tile-detail.png", "unity-tile-moved.png" }
                    .Select(file => new CaptureRecord { file = file, sha256 = FileHash(Path.Combine(output, file)) }).ToArray();
                File.WriteAllText(Path.Combine(output, "unity-validation.json"), JsonUtility.ToJson(report, true) + "\n");
                UnityEngine.Debug.Log("PASS: Blender study Unity validation; report=" + output);
            }
            catch (Exception error)
            {
                UnityEngine.Debug.LogException(error);
                throw;
            }
            finally
            {
                // Leave the imported models in baseline state for subsequent interactive checks.
                BlenderAssetStudy.ImportBaseline();
                if (previousScenes.Length > 0)
                    EditorSceneManager.RestoreSceneManagerSetup(previousScenes);
                else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }

        private static string OutputDirectory()
        {
            var args = Environment.GetCommandLineArgs();
            var index = Array.IndexOf(args, "-blenderStudyReportDir");
            if (index >= 0 && index + 1 < args.Length) return Path.GetFullPath(args[index + 1]);
            return Path.GetFullPath(Path.Combine(Application.dataPath, "../../blender/validation-local/unity-" +
                DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")));
        }

        private static Color FeltColor()
        {
            return AssetDatabase.LoadAssetAtPath<Material>(Root + "/Materials/Felt.mat").color;
        }

        private static MaterialRecord[] Materials()
        {
            return Directory.GetFiles(Root + "/Materials", "*.mat").OrderBy(path => path, StringComparer.Ordinal).Select(path => {
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                return new MaterialRecord { name = material.name, color = material.color,
                    metallic = material.GetFloat("_Metallic"), glossiness = material.GetFloat("_Glossiness") };
            }).ToArray();
        }

        private static string FileHash(string path)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
        }

        private static ModelRecord[] Snapshot()
        {
            return Names.Select((name, index) => {
                var instance = GameObject.Find(name);
                Require(instance != null, "Preview instance exists: " + name);
                var filters = instance.GetComponentsInChildren<MeshFilter>();
                var record = new ModelRecord {
                    name = name, guid = AssetDatabase.AssetPathToGUID(Root + "/Models/" + name + ".fbx"),
                    sourceFbxSha256 = FileHash(Root + "/Models/" + name + ".fbx"),
                    prefabGuid = AssetDatabase.AssetPathToGUID(PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance)),
                    position = instance.transform.position, rotation = instance.transform.eulerAngles,
                    scale = instance.transform.localScale, meshes = filters.Length
                };
                var bounds = new Bounds();
                var conservativeBounds = new Bounds();
                var first = true;
                var firstCorner = true;
                using (var stream = new MemoryStream())
                using (var writer = new BinaryWriter(stream))
                {
                    foreach (var filter in filters.OrderBy(filter => filter.name, StringComparer.Ordinal))
                    {
                        var mesh = filter.sharedMesh;
                        record.triangles += mesh.triangles.Length / 3;
                        record.vertices += mesh.vertexCount;
                        if (mesh.uv.Length == mesh.vertexCount) record.uvMeshes++;
                        if (mesh.normals.Length == mesh.vertexCount) record.normalMeshes++;
                        writer.Write(filter.name);
                        // The historical Blender manifest unions transformed local mesh
                        // bounding boxes, which overestimates rotated curved parts.
                        for (var corner = 0; corner < 8; corner++)
                        {
                            var sign = new Vector3((corner & 1) == 0 ? -1 : 1,
                                (corner & 2) == 0 ? -1 : 1, (corner & 4) == 0 ? -1 : 1);
                            var point = mesh.bounds.center + Vector3.Scale(mesh.bounds.extents, sign);
                            var local = filter.transform.TransformPoint(point) - instance.transform.position;
                            if (firstCorner) { conservativeBounds = new Bounds(local, Vector3.zero); firstCorner = false; }
                            else conservativeBounds.Encapsulate(local);
                        }
                        foreach (var point in mesh.vertices)
                        {
                            // Keep the FBX root's axis-conversion rotation and scale. Removing
                            // its full transform would incorrectly measure in Blender's axes.
                            var local = filter.transform.TransformPoint(point) - instance.transform.position;
                            if (first) { bounds = new Bounds(local, Vector3.zero); first = false; }
                            else bounds.Encapsulate(local);
                            writer.Write(local.x); writer.Write(local.y); writer.Write(local.z);
                        }
                        foreach (var normal in mesh.normals)
                        {
                            Require(normal.sqrMagnitude > .9f && normal.sqrMagnitude < 1.1f, "Unit normals: " + filter.name);
                            writer.Write(normal.x); writer.Write(normal.y); writer.Write(normal.z);
                        }
                        foreach (var uv in mesh.uv) { writer.Write(uv.x); writer.Write(uv.y); }
                        foreach (var triangle in mesh.triangles) writer.Write(triangle);
                    }
                    writer.Flush();
                    using (var sha = SHA256.Create())
                        record.geometrySha256 = BitConverter.ToString(sha.ComputeHash(stream.ToArray())).Replace("-", "").ToLowerInvariant();
                }
                record.boundsMin = bounds.min;
                record.boundsSize = bounds.size;
                record.conservativeMeshBoundsSize = conservativeBounds.size;
                Require(record.meshes == MeshCounts[index] && record.triangles == TriangleCounts[index], "Imported topology: " + name);
                Require(Vector3.Distance(conservativeBounds.size, Sizes[index]) < .0001f,
                    "Imported manifest bounds in metres and Y-up: " + name + " " + conservativeBounds.size);
                Require(record.uvMeshes == record.meshes && record.normalMeshes == record.meshes, "UVs/normals: " + name);
                if (name == "SoakuhinStudy")
                {
                    record.characterLandmarks = new[] { "Nose", "ChestCrest" }.Select(landmark =>
                        filters.Single(filter => filter.name == landmark).transform.position - instance.transform.position).ToArray();
                    Require(Vector3.Distance(record.characterLandmarks[0], new Vector3(0, 1.627f, -.099f)) < .0001f,
                        "Character faces -Z: nose matches Blender X/Z/Y");
                    Require(Vector3.Distance(record.characterLandmarks[1], new Vector3(.112f, 1.337f, -.122f)) < .0001f,
                        "Character X axis: asymmetric chest crest matches Blender X/Z/Y");
                }
                record.materialPaths = instance.GetComponentsInChildren<Renderer>()
                    .SelectMany(renderer => renderer.sharedMaterials).Select(material => {
                        Require(material != null && material.shader.name == "Standard", "Standard material: " + name);
                        var path = AssetDatabase.GetAssetPath(material);
                        Require(path.StartsWith(Root + "/Materials/", StringComparison.Ordinal), "External material remap: " + name);
                        return path;
                    }).Distinct().OrderBy(path => path, StringComparer.Ordinal).ToArray();
                return record;
            }).ToArray();
        }

        private static void Capture(Camera camera, string path, int width, int height)
        {
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var previousAspect = camera.aspect;
            var previousFov = camera.fieldOfView;
            var target = new RenderTexture(width, height, 24);
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
            try
            {
                camera.fieldOfView = 60;
                camera.aspect = (float)width / height;
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                texture.Apply();
                Require(texture.GetPixels32().Distinct().Take(32).Count() == 32, "Capture is not blank: " + path);
                File.WriteAllBytes(path, texture.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget; camera.aspect = previousAspect; camera.fieldOfView = previousFov;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(texture);
                target.Release(); UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void MeasureRender(Camera camera, Report report)
        {
            var previous = camera.targetTexture;
            var target = new RenderTexture(report.renderWidth, report.renderHeight, 24);
            var samples = new List<double>();
            try
            {
                camera.targetTexture = target;
                for (var i = 0; i < 35; i++)
                {
                    var watch = Stopwatch.StartNew();
                    camera.Render(); watch.Stop();
                    if (i >= 5) samples.Add(watch.Elapsed.TotalMilliseconds);
                }
            }
            finally { camera.targetTexture = previous; target.Release(); UnityEngine.Object.DestroyImmediate(target); }
            samples.Sort();
            report.renderSamples = samples.Count;
            report.renderCpuMedianMilliseconds = (samples[14] + samples[15]) / 2;
            report.renderCpuP95Milliseconds = samples[28];
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidDataException(message);
        }
    }
}
