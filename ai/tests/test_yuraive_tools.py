from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = PROJECT_ROOT / "ai" / "shared" / "scripts"
FIXTURES = PROJECT_ROOT / "ai" / "tests" / "fixtures"
INSPECT = SCRIPTS / "inspect_yuraive.py"
EDIT = SCRIPTS / "edit_yuraive.py"
sys.path.insert(0, str(SCRIPTS))

from edit_yuraive import EditError, apply_operations  # noqa: E402
from inspect_yuraive import inspect_source  # noqa: E402
from yuraive_json import loads_json  # noqa: E402


class InspectYuraiveTests(unittest.TestCase):
    def test_valid_fixture_has_no_issues(self) -> None:
        content = FIXTURES / "valid"
        graph = content / "graph.yuraive.json"
        report = inspect_source(
            graph.read_text(encoding="utf-8"),
            source_name=str(graph),
            content_dir=content,
        )

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["issueCounts"], {"error": 0, "warning": 0})
        self.assertEqual(report["summary"]["nodeCount"], 3)
        self.assertEqual(report["summary"]["reachableNodeCount"], 3)
        self.assertEqual(report["summary"]["deadEndNodes"], [])
        self.assertGreaterEqual(report["summary"]["assetCount"], 8)
        self.assertTrue(all(asset["status"] == "ok" for asset in report["assets"]))

    def test_broken_fixture_reports_ids_references_reachability_and_files(self) -> None:
        content = FIXTURES / "broken-references"
        graph = content / "graph.yuraive.json"
        report = inspect_source(
            graph.read_text(encoding="utf-8"),
            source_name=str(graph),
            content_dir=content,
        )
        codes = {issue["code"] for issue in report["issues"]}

        self.assertFalse(report["ok"])
        self.assertIn("duplicate_id", codes)
        self.assertIn("duplicate_button_reference", codes)
        self.assertIn("invalid_node_reference", codes)
        self.assertIn("invalid_button_reference", codes)
        self.assertIn("invalid_player_control_reference", codes)
        self.assertIn("unreachable_node", codes)
        self.assertIn("dead_end_node", codes)
        self.assertIn("missing_asset", codes)
        self.assertIn("unsafe_asset_path", codes)
        self.assertIn("orphan", report["summary"]["unreachableNodes"])
        self.assertIn("orphan", report["summary"]["deadEndNodes"])

    def test_invalid_json_is_a_validation_error(self) -> None:
        report = inspect_source('{"version": 1,', check_files=False)
        self.assertFalse(report["ok"])
        self.assertEqual(report["issues"][0]["code"], "invalid_json")

    def test_required_maps_and_layout_slot_references_are_checked(self) -> None:
        content = FIXTURES / "valid"
        graph = json.loads((content / "graph.yuraive.json").read_text(encoding="utf-8"))
        del graph["playerControls"]
        missing_map = inspect_source(json.dumps(graph), content_dir=content)
        self.assertIn(
            "missing_required_field",
            {issue["code"] for issue in missing_map["issues"]},
        )

        graph = json.loads((content / "graph.yuraive.json").read_text(encoding="utf-8"))
        graph["buttons"]["continue"]["targetSlot"] = "not-in-layout"
        bad_slot = inspect_source(json.dumps(graph), content_dir=content)
        self.assertIn(
            "invalid_layout_slot_reference",
            {issue["code"] for issue in bad_slot["issues"]},
        )

    def test_cli_formats_json_and_uses_stable_exit_codes(self) -> None:
        valid = FIXTURES / "valid" / "graph.yuraive.json"
        success = subprocess.run(
            [sys.executable, str(INSPECT), str(valid), "--format", "json"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertTrue(json.loads(success.stdout)["ok"])

        broken = FIXTURES / "broken-references" / "graph.yuraive.json"
        failure = subprocess.run(
            [sys.executable, str(INSPECT), str(broken), "--format", "json"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(failure.returncode, 1, failure.stderr)
        self.assertFalse(json.loads(failure.stdout)["ok"])

        missing = subprocess.run(
            [sys.executable, str(INSPECT), str(FIXTURES / "not-there.json")],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(missing.returncode, 2)

    def test_help_is_self_documenting(self) -> None:
        result = subprocess.run(
            [sys.executable, str(INSPECT), "--help"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("終了コード", result.stdout)
        self.assertIn("--content-dir", result.stdout)


class EditYuraiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.content = Path(self.temporary.name) / "content"
        shutil.copytree(FIXTURES / "valid", self.content)
        self.input = self.content / "graph.yuraive.json"
        self.edits = self.content / "edit-operations.json"

    def run_edit(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(EDIT),
                str(self.input),
                "--edits",
                str(self.edits),
                *extra,
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_default_edit_keeps_input_and_updates_all_references(self) -> None:
        original = self.input.read_text(encoding="utf-8")
        result = self.run_edit("--format", "json")
        output = self.content / "graph.yuraive.edited.json"

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.input.read_text(encoding="utf-8"), original)
        self.assertTrue(output.is_file())
        edited = json.loads(output.read_text(encoding="utf-8"))
        self.assertIn("intro", edited["nodes"])
        self.assertNotIn("start", edited["nodes"])
        self.assertEqual(edited["nodes"]["intro"]["buttons"], ["proceed"])
        self.assertIn("proceed", edited["buttons"])
        self.assertEqual(edited["globalPlayerControl"], "compact")
        self.assertEqual(edited["nodes"]["intro"]["playerControl"], "compact")
        self.assertIn("compact", edited["playerControls"])
        self.assertEqual(
            edited["nodes"]["intro"]["media"][0]["source"]["audio"],
            "audio/rain-renamed.ogg",
        )
        report = json.loads(result.stdout)
        self.assertFalse(report["validationPerformed"])
        self.assertGreater(report["changeCount"], report["operationCount"])
        self.assertIn('"intro"', report["diff"])

    def test_edited_result_remains_structurally_valid_without_file_check(self) -> None:
        result = self.run_edit()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = self.content / "graph.yuraive.edited.json"
        inspected = subprocess.run(
            [sys.executable, str(INSPECT), str(output), "--skip-files", "--format", "json"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(inspected.returncode, 0, inspected.stdout)

    def test_existing_default_output_is_not_overwritten(self) -> None:
        first = self.run_edit()
        self.assertEqual(first.returncode, 0, first.stderr)
        output = self.content / "graph.yuraive.edited.json"
        before = output.read_text(encoding="utf-8")
        second = self.run_edit()
        self.assertEqual(second.returncode, 2)
        self.assertEqual(output.read_text(encoding="utf-8"), before)

    def test_bounds_and_expectations_fail_before_writing(self) -> None:
        document = loads_json(self.input.read_text(encoding="utf-8"))
        operations = [
            {"op": "set", "path": "/metadata/displayName", "expect": "wrong", "value": "new"}
        ]
        with self.assertRaises(EditError):
            apply_operations(document, operations)
        with self.assertRaises(EditError):
            apply_operations(
                document,
                [
                    {"op": "set", "path": "/version", "expect": 1, "value": 2},
                    {"op": "set", "path": "/version", "expect": 2, "value": 1},
                ],
                max_operations=1,
            )

    def test_scalar_add_and_remove_are_bounded_and_preconditioned(self) -> None:
        document = loads_json(self.input.read_text(encoding="utf-8"))
        edited, changes, _ = apply_operations(
            document,
            [
                {"op": "add", "path": "/metadata/author", "value": "Fixture Author"},
                {"op": "remove", "path": "/metadata/tags/0", "expect": "fixture"},
            ],
        )
        self.assertEqual(edited["metadata"]["author"], "Fixture Author")
        self.assertEqual(edited["metadata"]["tags"], ["rain"])
        self.assertEqual(len(changes), 2)

    def test_explicit_in_place_edit_creates_a_backup(self) -> None:
        original = self.input.read_text(encoding="utf-8")
        result = self.run_edit("--in-place", "--format", "json")
        backup = Path(f"{self.input}.bak")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(backup.is_file())
        self.assertEqual(backup.read_text(encoding="utf-8"), original)
        self.assertNotEqual(self.input.read_text(encoding="utf-8"), original)

    def test_dry_run_writes_nothing_and_help_lists_safety_controls(self) -> None:
        result = self.run_edit("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.content / "graph.yuraive.edited.json").exists())
        self.assertIn("dry-run", result.stdout)

        help_result = subprocess.run(
            [sys.executable, str(EDIT), "--help"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("既定では入力を上書きしません", help_result.stdout)
        self.assertIn("--max-operations", help_result.stdout)
        self.assertIn("終了コード", help_result.stdout)


if __name__ == "__main__":
    unittest.main()
