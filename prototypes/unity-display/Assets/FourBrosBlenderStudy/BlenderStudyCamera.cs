using UnityEngine;

namespace FourBros.BlenderStudy
{
    public sealed class BlenderStudyCamera : MonoBehaviour
    {
        public Transform tile;
        private float yaw = 25, pitch = 25, distance = 3.1f;
        private Vector3 tileStart;
        private Vector3 moveStart, moveTarget;
        private float movement = 1;
        private bool moveOut;

        public void SetInitialView()
        {
            transform.position = new Vector3(0, .8f, 0) +
                Quaternion.Euler(pitch, yaw, 0) * new Vector3(0, 0, -distance);
            transform.LookAt(new Vector3(0, .8f, 0));
        }

        private void Start()
        {
            if (tile != null) tileStart = moveStart = moveTarget = tile.position;
            SetInitialView();
        }

        private void Update()
        {
            if (Input.GetMouseButton(1))
            {
                yaw += Input.GetAxis("Mouse X") * 3;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * 3, 5, 80);
            }
            distance = Mathf.Clamp(distance - Input.mouseScrollDelta.y * .15f, .6f, 6);
            SetInitialView();
            if (tile == null) return;
            if (Input.GetKeyDown(KeyCode.Space))
            {
                moveOut = !moveOut;
                moveStart = tile.position;
                moveTarget = tileStart + (moveOut ? Vector3.right * .16f : Vector3.zero);
                movement = 0;
            }
            movement = Mathf.Min(1, movement + Time.deltaTime / .2f);
            var t = Mathf.SmoothStep(0, 1, movement);
            tile.position = Vector3.Lerp(moveStart, moveTarget, t);
        }

        private void OnGUI()
        {
            GUI.Box(new Rect(12, 12, 450, 60),
                "BLENDER ASSET STUDY / static prototype\nRMB drag: orbit   Wheel: zoom   Space: move tile (200 ms)");
        }
    }
}
