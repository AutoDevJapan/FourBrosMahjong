using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace FourBros.BlenderStudy
{
    // Built-in pipeline; no third-party importer/package. Editor validation pending.
    public static class BlenderAssetStudy
    {
        private const string Destination = "Assets/FourBrosBlenderStudy";
        private static readonly string[] AssetNames = { "MahjongTable", "TilePin5", "SoakuhinStudy" };
        // Kept in sync with prototypes/blender/render_unity_parity.py defaults.
        private const int ParityWidth = 960;
        private const int ParityHeight = 540;
        private const float ParityVerticalFov = 60;

        [Serializable] private sealed class PaletteEntry
        {
            public string name;
            public float[] rgba;
            public float metallic;
            public float roughness;
        }
        [Serializable] private sealed class Manifest
        {
            public int schemaVersion;
            public string variant;
            public PaletteEntry[] materialPalette;
        }

        [MenuItem("FourBros/Blender Study/1 Import baseline")]
        public static void ImportBaseline() { Import(false); }

        [MenuItem("FourBros/Blender Study/3 Reimport blue felt revision")]
        public static void ImportRevision() { Import(true); }

        private static string FindSource(bool revision)
        {
            var directory = new DirectoryInfo(Application.dataPath);
            while (directory != null)
            {
                var candidate = Path.Combine(directory.FullName, "prototypes", "blender", "generated");
                if (revision) candidate = Path.Combine(candidate, "revision");
                if (File.Exists(Path.Combine(candidate, "manifest.json"))) return candidate;
                directory = directory.Parent;
            }
            var selected = EditorUtility.OpenFolderPanel("Select Blender generated folder" +
                (revision ? " / revision" : ""), "", "");
            if (string.IsNullOrEmpty(selected)) throw new OperationCanceledException("No source folder selected.");
            return selected;
        }

        private static void Import(bool revision)
        {
            var source = FindSource(revision);
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(Path.Combine(source, "manifest.json")));
            if (manifest == null || manifest.schemaVersion != 1 || manifest.materialPalette == null ||
                manifest.variant != (revision ? "revision" : "baseline"))
                throw new InvalidDataException("Expected matching schemaVersion 1 Blender study manifest.");
            foreach (var name in AssetNames)
                if (!File.Exists(Path.Combine(source, name + ".fbx")))
                    throw new FileNotFoundException("Missing Blender asset: " + name);
            foreach (var entry in manifest.materialPalette)
                if (entry.name == null || entry.name.IndexOfAny(new[] { '/', '\\', '.' }) >= 0 ||
                    entry.rgba == null || entry.rgba.Length != 4)
                    throw new InvalidDataException("Invalid material palette entry.");

            Directory.CreateDirectory(Destination + "/Models");
            Directory.CreateDirectory(Destination + "/Materials");
            AssetDatabase.Refresh();
            var shader = Shader.Find("Standard");
            if (shader == null) throw new InvalidOperationException("This study requires the Built-in Render Pipeline.");
            foreach (var entry in manifest.materialPalette)
            {
                var path = Destination + "/Materials/" + entry.name + ".mat";
                var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (mat == null)
                {
                    mat = new Material(shader);
                    AssetDatabase.CreateAsset(mat, path);
                }
                mat.color = new Color(entry.rgba[0], entry.rgba[1], entry.rgba[2], entry.rgba[3]);
                mat.SetFloat("_Metallic", entry.metallic);
                mat.SetFloat("_Glossiness", 1f - entry.roughness);
                EditorUtility.SetDirty(mat);
            }
            foreach (var name in AssetNames)
            {
                var path = Destination + "/Models/" + name + ".fbx";
                var previousGuid = AssetDatabase.AssetPathToGUID(path);
                // Retain .meta files: Unity references and instance transforms survive reimport.
                File.Copy(Path.Combine(source, name + ".fbx"), path, true);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                var importer = (ModelImporter)AssetImporter.GetAtPath(path);
                importer.globalScale = 1;
                importer.useFileScale = true;
                importer.importAnimation = false;
                importer.importCameras = false;
                importer.importLights = false;
                importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
                foreach (var entry in manifest.materialPalette)
                    importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), entry.name),
                        AssetDatabase.LoadAssetAtPath<Material>(Destination + "/Materials/" + entry.name + ".mat"));
                importer.SaveAndReimport();
                var guid = AssetDatabase.AssetPathToGUID(path);
                if (!string.IsNullOrEmpty(previousGuid) && guid != previousGuid)
                    throw new InvalidOperationException("Reimport changed GUID for " + name);
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (model == null || model.GetComponentsInChildren<MeshFilter>(true).Length == 0)
                    throw new InvalidDataException("No mesh imported for " + name);
                Debug.Log("Blender study imported: " + name + " variant=" + manifest.variant + " GUID=" + guid);
            }
            AssetDatabase.SaveAssets();
        }

        [MenuItem("FourBros/Blender Study/2 Build asset preview scene")]
        public static void BuildScene()
        {
            // Preflight before changing the active scene. Preserve existing scene and edits.
            foreach (var name in AssetNames)
                if (AssetDatabase.LoadAssetAtPath<GameObject>(Destination + "/Models/" + name + ".fbx") == null)
                    throw new InvalidOperationException("Run Import baseline first.");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            SceneManager.SetActiveScene(scene);
            var table = InstantiateModel("MahjongTable", new Vector3(-.38f, 0, 0));
            InstantiateModel("SoakuhinStudy", new Vector3(.54f, 0, .15f));
            var tile = InstantiateModel("TilePin5", new Vector3(-.38f, .768f, -.16f));
            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.name = "Preview floor";
            floor.transform.localScale = Vector3.one;
            floor.transform.position = new Vector3(0, -.01f, 0);
            var cameraObject = new GameObject("Preview camera", typeof(Camera));
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.GetComponent<Camera>();
            camera.nearClipPlane = .01f;
            camera.farClipPlane = 100;
            camera.backgroundColor = new Color(.07f, .09f, .12f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            var lightObject = new GameObject("Key light", typeof(Light));
            var light = lightObject.GetComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            lightObject.transform.rotation = Quaternion.Euler(40, -35, 0);
            RenderSettings.ambientLight = new Color(.35f, .35f, .35f);
            var controller = cameraObject.AddComponent<BlenderStudyCamera>();
            controller.tile = tile.transform;
            controller.SetInitialView();
            Directory.CreateDirectory(Destination + "/Scenes");
            AssetDatabase.Refresh();
            var path = AssetDatabase.GenerateUniqueAssetPath(Destination + "/Scenes/BlenderStudy.unity");
            if (!EditorSceneManager.SaveScene(scene, path)) throw new IOException("Could not save preview scene.");
            Selection.activeGameObject = table;
            Debug.Log("Blender preview saved: " + path + ". Enter Play; drag RMB / wheel / Space.");
        }

        // Matches prototypes/blender/render_unity_parity.py so the two PNGs share framing.
        [MenuItem("FourBros/Blender Study/4 Capture Unity parity screenshot")]
        public static void CaptureParityScreenshot()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Exit Play mode before capturing so the tile is at its original position.");
            var cameraObject = GameObject.Find("Preview camera");
            if (cameraObject == null)
                throw new InvalidOperationException("Open the preview scene from step 2 before capturing.");
            var camera = cameraObject.GetComponent<Camera>();
            if (camera == null) throw new InvalidOperationException("Preview camera has no Camera component.");
            var controller = cameraObject.GetComponent<BlenderStudyCamera>();
            if (controller == null) throw new InvalidOperationException("Preview camera has no BlenderStudyCamera component.");
            controller.ResetInitialView();
            var previousFov = camera.fieldOfView;
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            camera.fieldOfView = ParityVerticalFov;
            camera.aspect = (float)ParityWidth / ParityHeight;
            var texture = new RenderTexture(ParityWidth, ParityHeight, 24, RenderTextureFormat.ARGB32);
            var image = new Texture2D(ParityWidth, ParityHeight, TextureFormat.RGB24, false);
            try
            {
                camera.targetTexture = texture;
                camera.Render();
                RenderTexture.active = texture;
                image.ReadPixels(new Rect(0, 0, ParityWidth, ParityHeight), 0, 0);
                image.Apply();
                Directory.CreateDirectory(Destination + "/Captures");
                var path = Destination + "/Captures/unity-camera-parity.png";
                File.WriteAllBytes(path, image.EncodeToPNG());
                AssetDatabase.Refresh();
                Debug.Log("Unity parity capture written: " + path +
                    ". Compare with prototypes/blender/generated/unity-camera-parity.png " +
                    "(same camera transform and FOV; lighting is deliberately not matched).");
            }
            finally
            {
                camera.targetTexture = previousTarget;
                camera.fieldOfView = previousFov;
                camera.ResetAspect();
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(image);
                texture.Release();
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static GameObject InstantiateModel(string name, Vector3 position)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(Destination + "/Models/" + name + ".fbx");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            instance.name = name;
            instance.transform.position = position;
            return instance;
        }
    }
}
