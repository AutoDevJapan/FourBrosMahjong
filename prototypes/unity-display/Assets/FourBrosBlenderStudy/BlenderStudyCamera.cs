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
        private Vector3 pivot = new Vector3(0, .8f, 0);

        public void ResetInitialView()
        {
            yaw = 25;
            pitch = 25;
            distance = 3.1f;
            pivot = new Vector3(0, .8f, 0);
            SetInitialView();
        }

        public void SetInitialView()
        {
            transform.position = pivot +
                Quaternion.Euler(pitch, yaw, 0) * new Vector3(0, 0, -distance);
            transform.LookAt(pivot);
        }

        private void Start()
        {
            InitializeTile();
            SetInitialView();
        }

        public void InitializeTile()
        {
            if (tile != null) tileStart = moveStart = moveTarget = tile.position;
            movement = 1;
            moveOut = false;
        }

        public void Orbit(float horizontal, float vertical)
        {
            yaw += horizontal * 3;
            pitch = Mathf.Clamp(pitch - vertical * 3, 5, 80);
            SetInitialView();
        }

        public void Zoom(float scroll)
        {
            distance = Mathf.Clamp(distance - scroll * .15f, .6f, 6);
            SetInitialView();
        }

        public void FocusTile()
        {
            if (tile == null) return;
            pivot = tile.position;
            distance = .6f;
            pitch = 65;
            SetInitialView();
        }

        public void ToggleTileMovement()
        {
            if (tile == null) return;
            moveOut = !moveOut;
            moveStart = tile.position;
            moveTarget = tileStart + (moveOut ? Vector3.right * .16f : Vector3.zero);
            movement = 0;
        }

        public void AdvanceTileMovement(float seconds)
        {
            if (tile == null) return;
            movement = Mathf.Min(1, movement + seconds / .2f);
            var t = Mathf.SmoothStep(0, 1, movement);
            tile.position = Vector3.Lerp(moveStart, moveTarget, t);
        }

        private void Update()
        {
            if (Input.GetMouseButton(1))
                Orbit(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"));
            Zoom(Input.mouseScrollDelta.y);
            if (Input.GetKeyDown(KeyCode.F)) FocusTile();
            if (Input.GetKeyDown(KeyCode.Home)) ResetInitialView();
            if (Input.GetKeyDown(KeyCode.Space)) ToggleTileMovement();
            AdvanceTileMovement(Time.deltaTime);
        }

        private void OnGUI()
        {
            GUI.Box(new Rect(12, 12, 520, 70),
                "BLENDER ASSET STUDY / static prototype\nRMB drag: orbit   Wheel: zoom   Space: move tile (200 ms)\nF: focus tile   Home: reset camera");
        }
    }
}
