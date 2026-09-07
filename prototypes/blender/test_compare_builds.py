"""Run with python3 -m unittest discover -s prototypes/blender -p 'test_*.py'."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


# The manifest and topology guards do not need a Blender installation.
spec = importlib.util.spec_from_file_location(
    "compare_builds", Path(__file__).with_name("compare_builds.py"))
compare = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {
    "bpy": types.SimpleNamespace(),
    "verify_fbx": types.SimpleNamespace(inspect=None),
}):
    spec.loader.exec_module(compare)


class CompareBuildsTests(unittest.TestCase):
    def test_face_storage_order_and_cyclic_rotation_are_ignored(self):
        self.assertEqual(compare.canonical_faces([[0, 1, 2], [2, 3, 0]]),
                         compare.canonical_faces([[3, 0, 2], [1, 2, 0]]))

    def test_face_winding_and_duplicate_faces_are_significant(self):
        faces = [[0, 1, 2], [0, 2, 3]]
        self.assertNotEqual(compare.canonical_faces(faces),
                            compare.canonical_faces([[2, 1, 0], [0, 2, 3]]))
        self.assertNotEqual(compare.canonical_faces(faces),
                            compare.canonical_faces([[0, 1, 2], [0, 1, 2]]))

    def test_missing_extra_and_empty_asset_sets_fail_before_import(self):
        for left, right, error in [
            ({"Tile": {}}, {"Tile": {}, "Extra": {}}, "Asset sets differ"),
            ({"Tile": {}, "Extra": {}}, {"Tile": {}}, "Asset sets differ"),
            ({}, {}, "No assets to compare"),
        ]:
            with self.subTest(left=left, right=right), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for side, assets in [("left", left), ("right", right)]:
                    (root / side).mkdir()
                    (root / side / "manifest.json").write_text(json.dumps({
                        "variant": "baseline", "assets": assets,
                    }), encoding="utf-8")
                report = root / "report.json"
                with patch.object(sys, "argv", [
                    "compare_builds.py", "--", "--left", str(root / "left"),
                    "--right", str(root / "right"), "--report", str(report),
                ]), self.assertRaisesRegex(AssertionError, error):
                    compare.main()
                self.assertFalse(report.exists())


if __name__ == "__main__":
    unittest.main()
