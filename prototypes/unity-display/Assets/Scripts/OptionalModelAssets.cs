using UnityEngine;

namespace FourBros.Display
{
    // Optional FBX/prefab adapter seam. Display state never depends on external geometry.
    public interface IDisplayAssetProvider
    {
        GameObject CreateVisual(string kind, Transform parent);
    }

    public sealed class OptionalModelAssets : MonoBehaviour, IDisplayAssetProvider
    {
        [Tooltip("Optional prefab/FBX, unit bounds, centered pivot; X=width, Y=height, Z=depth")]
        public GameObject tile;
        public GameObject table;
        [Tooltip("Optional original stand-in; upright +Y, facing -Z, feet at origin, about 1 unit tall")]
        public GameObject character;

        public GameObject CreateVisual(string kind, Transform parent)
        {
            GameObject asset = kind == "tile" ? tile : kind == "table" ? table : character;
            if (asset == null) return null;
            var instance = Instantiate(asset, parent, false);
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;
            return instance;
        }
    }
}
