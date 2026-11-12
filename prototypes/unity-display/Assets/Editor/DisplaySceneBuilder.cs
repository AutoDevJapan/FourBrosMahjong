using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace FourBros.Display.Editor
{
    public static class DisplaySceneBuilder
    {
        public const string Generated = "Assets/Generated";
        public const string ScenePath = Generated + "/DisplayPrototype.unity";
        public static string ContractPath => Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../../documents/fixtures/unity-display-contract.json"));

        [MenuItem("Four Bros/Build display scene")]
        public static void CreateScene()
        {
            TryCreateScene();
        }

        private static bool TryCreateScene()
        {
            if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
            if (!File.Exists(ContractPath)) throw new FileNotFoundException("Open this project inside the FourBrosMahjong checkout", ContractPath);
            string json = File.ReadAllText(ContractPath);
            var contract = JsonUtility.FromJson<ContractFixture>(json);
            DisplayContractChecks.Run(contract); // Fail before writing generated assets on contract drift.
            Directory.CreateDirectory(Generated);
            File.Copy(ContractPath, Generated + "/unity-display-contract.json", true);
            AssetDatabase.Refresh();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Display camera").AddComponent<Camera>();
            camera.tag = "MainCamera";
            camera.orthographic = true; camera.orthographicSize = 6.2f;
            camera.transform.position = new Vector3(0, 15, 0);
            camera.transform.rotation = Quaternion.Euler(90, 0, 0);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.035f, .05f, .07f);
            var root = new GameObject("Four Bros Display Prototype");
            var display = root.AddComponent<UnityDisplayPrototype>();
            display.optionalAssets = root.AddComponent<OptionalModelAssets>();
            display.fixture = AssetDatabase.LoadAssetAtPath<TextAsset>(Generated + "/unity-display-contract.json");
            display.tileMaterial = Material("Tile", new Color(.94f, .92f, .83f));
            display.backMaterial = Material("Back", new Color(.13f, .3f, .7f));
            display.tableMaterial = Material("Table", new Color(.06f, .27f, .21f));
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            PlayerSettings.companyName = "AutoDevJapan";
            PlayerSettings.productName = "Four Bros Display Prototype";
            PlayerSettings.defaultScreenWidth = 1440;
            PlayerSettings.defaultScreenHeight = 1000;
            AssetDatabase.SaveAssets();
            Debug.Log("#818 generated " + ScenePath + " from " + ContractPath + ". Enter Play Mode for visual validation.");
            return true;
        }

        private static Material Material(string name, Color color)
        {
            string path = Generated + "/" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                var shader = Shader.Find("Unlit/Color");
                if (shader == null) throw new InvalidOperationException("Built-in Unlit/Color shader unavailable");
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = color;
            EditorUtility.SetDirty(material);
            return material;
        }

        [MenuItem("Four Bros/Validate display contract")]
        public static void Validate()
        {
            int checks = DisplayContractChecks.Run(JsonUtility.FromJson<ContractFixture>(File.ReadAllText(ContractPath)));
            Debug.Log("#818 Unity JsonUtility display contract: " + checks + " assertions passed (not a rendering test)");
        }

        // Run explicitly; never launches a build/import on editor startup.
        [MenuItem("Four Bros/Build macOS prototype")]
        public static void BuildMac()
        {
            if (!TryCreateScene())
                throw new InvalidOperationException("Scene creation cancelled; no build performed");
            Directory.CreateDirectory("Builds");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath }, locationPathName = "Builds/DisplayPrototype.app",
                target = BuildTarget.StandaloneOSX, options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Prototype build failed: " + report.summary.result);
            Debug.Log("#818 build size bytes: " + report.summary.totalSize);
        }
    }
}
