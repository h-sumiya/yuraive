#!/usr/bin/env python3
"""Apply bounded, explicit edits to a Yuraive JSON document.

The editor intentionally does not validate the resulting graph. Run
inspect_yuraive.py on the output as a separate read-only step.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

sys.dont_write_bytecode = True

from yuraive_json import (
    duplicate_keys,
    is_json_scalar,
    json_equal,
    loads_json,
    pointer_escape,
    pointer_join,
    stable_json,
    to_plain,
)


EXIT_OK = 0
EXIT_USAGE = 2
DEFAULT_MAX_OPERATIONS = 100
HARD_MAX_OPERATIONS = 1_000
DEFAULT_MAX_CHANGES = 1_000
HARD_MAX_CHANGES = 10_000
HARD_MAX_OUTPUT_BYTES = 50 * 1024 * 1024
FORBIDDEN_POINTER_SEGMENTS = {"__proto__", "prototype", "constructor"}


class EditError(ValueError):
    pass


@dataclass
class Change:
    operation: int
    action: str
    path: str
    before: Any
    after: Any

    def as_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "action": self.action,
            "path": self.path,
            "before": self.before,
            "after": self.after,
        }


def parse_pointer(pointer: Any) -> list[str]:
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise EditError("pathは / で始まるJSON Pointerにしてください")
    if pointer == "/":
        segments = [""]
    else:
        segments = pointer[1:].split("/")
    if len(segments) > 32:
        raise EditError("JSON Pointerは32階層以内にしてください")
    decoded: list[str] = []
    for raw in segments:
        index = 0
        value = ""
        while index < len(raw):
            if raw[index] != "~":
                value += raw[index]
                index += 1
                continue
            if index + 1 >= len(raw) or raw[index + 1] not in ("0", "1"):
                raise EditError(f"JSON Pointerのエスケープが不正です: {pointer}")
            value += "~" if raw[index + 1] == "0" else "/"
            index += 2
        if value in FORBIDDEN_POINTER_SEGMENTS:
            raise EditError(f"安全のためpath要素「{value}」は編集できません")
        decoded.append(value)
    return decoded


def list_index(segment: str, length: int, allow_end: bool = False) -> int:
    if not segment.isdigit() or (len(segment) > 1 and segment.startswith("0")):
        raise EditError(f"配列インデックスが不正です: {segment}")
    index = int(segment)
    upper = length if allow_end else length - 1
    if index < 0 or index > upper:
        raise EditError(f"配列インデックスが範囲外です: {segment}")
    return index


def resolve_parent(document: Any, pointer: str) -> tuple[Any, str]:
    segments = parse_pointer(pointer)
    current = document
    for segment in segments[:-1]:
        if isinstance(current, dict):
            if segment not in current:
                raise EditError(f"pathの途中が見つかりません: {pointer}")
            current = current[segment]
        elif isinstance(current, list):
            current = current[list_index(segment, len(current))]
        else:
            raise EditError(f"pathの途中がオブジェクトまたは配列ではありません: {pointer}")
    return current, segments[-1]


def target_value(parent: Any, segment: str, pointer: str) -> Any:
    if isinstance(parent, dict):
        if segment not in parent:
            raise EditError(f"編集対象が見つかりません: {pointer}")
        return parent[segment]
    if isinstance(parent, list):
        return parent[list_index(segment, len(parent))]
    raise EditError(f"編集対象の親がオブジェクトまたは配列ではありません: {pointer}")


def safe_relative_path(path: str) -> bool:
    return (
        bool(path)
        and not path.startswith("/")
        and "\\" not in path
        and ":" not in path
        and all(part not in ("", ".", "..") for part in path.split("/"))
        and all(ord(character) >= 32 for character in path)
    )


def add_change(
    changes: list[Change],
    operation: int,
    action: str,
    path: str,
    before: Any,
    after: Any,
) -> None:
    changes.append(Change(operation, action, path, before, after))


def replace_member(
    container: dict[str, Any],
    key: str,
    expected: str,
    replacement: str,
    path: str,
    operation: int,
    changes: list[Change],
) -> None:
    if container.get(key) == expected:
        container[key] = replacement
        add_change(changes, operation, "replace", path, expected, replacement)


def replace_list_values(
    values: Any,
    expected: str,
    replacement: str,
    base_path: str,
    operation: int,
    changes: list[Change],
) -> None:
    if not isinstance(values, list):
        return
    for index, value in enumerate(values):
        if value == expected:
            values[index] = replacement
            add_change(
                changes,
                operation,
                "replace",
                pointer_join(base_path, index),
                expected,
                replacement,
            )


def replace_transition_targets(
    transitions: Any,
    expected: str,
    replacement: str,
    base_path: str,
    operation: int,
    changes: list[Change],
) -> None:
    if not isinstance(transitions, list):
        return
    for index, transition in enumerate(transitions):
        if isinstance(transition, dict):
            replace_member(
                transition,
                "to",
                expected,
                replacement,
                pointer_join(pointer_join(base_path, index), "to"),
                operation,
                changes,
            )


def rename_map_key(
    mapping: dict[str, Any],
    map_path: str,
    expected: str,
    replacement: str,
    operation: int,
    changes: list[Change],
) -> None:
    if expected not in mapping:
        raise EditError(f"変更元IDが見つかりません: {expected}")
    if replacement in mapping:
        raise EditError(f"変更先IDが既に存在します: {replacement}")
    items = [
        (replacement if key == expected else key, value)
        for key, value in mapping.items()
    ]
    mapping.clear()
    mapping.update(items)
    add_change(
        changes,
        operation,
        "renameId",
        pointer_join(map_path, expected),
        expected,
        replacement,
    )


def apply_rename_id(
    graph: dict[str, Any], operation: dict[str, Any], index: int, changes: list[Change]
) -> None:
    kind = operation.get("kind")
    expected = operation.get("from")
    replacement = operation.get("to")
    if kind not in ("node", "button", "playerControl"):
        raise EditError("renameId.kindはnode、button、playerControlのいずれかにしてください")
    if not isinstance(expected, str) or not expected:
        raise EditError("renameId.fromは空でないIDにしてください")
    if not isinstance(replacement, str) or not replacement.strip():
        raise EditError("renameId.toは空でないIDにしてください")
    if expected == replacement:
        raise EditError("renameId.fromとtoが同じです")
    map_name = {"node": "nodes", "button": "buttons", "playerControl": "playerControls"}[kind]
    mapping = graph.get(map_name)
    if not isinstance(mapping, dict):
        raise EditError(f"入力の{map_name}がオブジェクトではありません")
    rename_map_key(mapping, f"/{map_name}", expected, replacement, index, changes)
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), dict) else {}
    buttons = graph.get("buttons") if isinstance(graph.get("buttons"), dict) else {}
    if kind == "node":
        for node_id, node in nodes.items():
            if isinstance(node, dict):
                replace_transition_targets(
                    node.get("onEnd"),
                    expected,
                    replacement,
                    pointer_join(pointer_join("/nodes", node_id), "onEnd"),
                    index,
                    changes,
                )
        for button_id, button in buttons.items():
            if isinstance(button, dict):
                replace_transition_targets(
                    button.get("onPress"),
                    expected,
                    replacement,
                    pointer_join(pointer_join("/buttons", button_id), "onPress"),
                    index,
                    changes,
                )
    elif kind == "button":
        for node_id, node in nodes.items():
            if isinstance(node, dict):
                replace_list_values(
                    node.get("buttons"),
                    expected,
                    replacement,
                    pointer_join(pointer_join("/nodes", node_id), "buttons"),
                    index,
                    changes,
                )
    else:
        replace_member(
            graph,
            "globalPlayerControl",
            expected,
            replacement,
            "/globalPlayerControl",
            index,
            changes,
        )
        for node_id, node in nodes.items():
            if isinstance(node, dict):
                replace_member(
                    node,
                    "playerControl",
                    expected,
                    replacement,
                    pointer_join(pointer_join("/nodes", node_id), "playerControl"),
                    index,
                    changes,
                )


def path_members(graph: dict[str, Any]) -> Iterable[tuple[dict[str, Any], str, str]]:
    metadata = graph.get("metadata")
    if isinstance(metadata, dict) and "thumbnail" in metadata:
        yield metadata, "thumbnail", "/metadata/thumbnail"
    stats = graph.get("playbackStats")
    if isinstance(stats, dict) and "path" in stats:
        yield stats, "path", "/playbackStats/path"
    nodes = graph.get("nodes")
    if isinstance(nodes, dict):
        for node_id, node in nodes.items():
            node_path = pointer_join("/nodes", node_id)
            if not isinstance(node, dict):
                continue
            script = node.get("script")
            if isinstance(script, dict) and "path" in script:
                yield script, "path", pointer_join(pointer_join(node_path, "script"), "path")
            media = node.get("media")
            if isinstance(media, list):
                for media_index, candidate in enumerate(media):
                    if not isinstance(candidate, dict):
                        continue
                    source = candidate.get("source")
                    if not isinstance(source, dict):
                        continue
                    source_path = pointer_join(
                        pointer_join(pointer_join(node_path, "media"), media_index), "source"
                    )
                    for name in ("audio", "image", "video", "subtitle"):
                        if name in source:
                            yield source, name, pointer_join(source_path, name)
    buttons = graph.get("buttons")
    if isinstance(buttons, dict):
        for button_id, button in buttons.items():
            if not isinstance(button, dict):
                continue
            button_path = pointer_join("/buttons", button_id)
            render = button.get("render")
            if isinstance(render, dict) and "path" in render:
                yield render, "path", pointer_join(pointer_join(button_path, "render"), "path")
            style = button.get("style")
            if isinstance(style, dict) and "backgroundImage" in style:
                yield style, "backgroundImage", pointer_join(
                    pointer_join(button_path, "style"), "backgroundImage"
                )
    controls = graph.get("playerControls")
    if isinstance(controls, dict):
        for control_id, control in controls.items():
            if isinstance(control, dict) and "layout" in control:
                yield control, "layout", pointer_join(
                    pointer_join("/playerControls", control_id), "layout"
                )


def apply_replace_path(
    graph: dict[str, Any], operation: dict[str, Any], index: int, changes: list[Change]
) -> None:
    expected = operation.get("from")
    replacement = operation.get("to")
    if not isinstance(expected, str) or not expected:
        raise EditError("replacePath.fromは空でないパスにしてください")
    if not isinstance(replacement, str) or not safe_relative_path(replacement):
        raise EditError("replacePath.toは安全な相対パスにしてください")
    if expected == replacement:
        raise EditError("replacePath.fromとtoが同じです")
    before = len(changes)
    for container, key, path in path_members(graph):
        replace_member(container, key, expected, replacement, path, index, changes)
    editor = graph.get("editor")
    layouts = editor.get("layouts") if isinstance(editor, dict) else None
    if isinstance(layouts, dict) and expected in layouts:
        if replacement in layouts:
            raise EditError(f"editor.layoutsの変更先パスが既に存在します: {replacement}")
        rename_map_key(layouts, "/editor/layouts", expected, replacement, index, changes)
    if len(changes) == before:
        raise EditError(f"置換対象の参照パスが見つかりません: {expected}")


def require_scalar(operation: dict[str, Any], name: str) -> Any:
    if name not in operation:
        raise EditError(f"{operation.get('op')}.{name}は必須です")
    value = operation[name]
    if not is_json_scalar(value):
        raise EditError(f"{operation.get('op')}.{name}はJSONの文字列・数値・真偽値・nullに限定されます")
    return value


def apply_set(
    graph: dict[str, Any], operation: dict[str, Any], index: int, changes: list[Change]
) -> None:
    pointer = operation.get("path")
    segments = parse_pointer(pointer)
    if not segments:
        raise EditError("JSONのルートはsetできません")
    expected = require_scalar(operation, "expect")
    replacement = require_scalar(operation, "value")
    parent, segment = resolve_parent(graph, pointer)
    current = target_value(parent, segment, pointer)
    if not is_json_scalar(current):
        raise EditError("setは既存のJSONスカラー値だけを変更できます")
    if not json_equal(current, expected):
        raise EditError(
            f"set.expectが現在値と一致しません: {pointer}（現在 {compact_json(current)}）"
        )
    if json_equal(current, replacement):
        raise EditError(f"set.valueが現在値と同じです: {pointer}")
    if isinstance(parent, dict):
        parent[segment] = replacement
    else:
        parent[list_index(segment, len(parent))] = replacement
    add_change(changes, index, "set", pointer, current, replacement)


def apply_add(
    graph: dict[str, Any], operation: dict[str, Any], index: int, changes: list[Change]
) -> None:
    pointer = operation.get("path")
    parse_pointer(pointer)
    value = require_scalar(operation, "value")
    parent, segment = resolve_parent(graph, pointer)
    if isinstance(parent, dict):
        if segment in parent:
            raise EditError(f"addの対象が既に存在します: {pointer}")
        parent[segment] = value
    elif isinstance(parent, list):
        if segment == "-":
            parent.append(value)
        else:
            parent.insert(list_index(segment, len(parent), allow_end=True), value)
    else:
        raise EditError(f"add対象の親がオブジェクトまたは配列ではありません: {pointer}")
    add_change(changes, index, "add", pointer, None, value)


def apply_remove(
    graph: dict[str, Any], operation: dict[str, Any], index: int, changes: list[Change]
) -> None:
    pointer = operation.get("path")
    parse_pointer(pointer)
    expected = require_scalar(operation, "expect")
    parent, segment = resolve_parent(graph, pointer)
    current = target_value(parent, segment, pointer)
    if not is_json_scalar(current):
        raise EditError("removeはJSONスカラー値だけを削除できます")
    if not json_equal(current, expected):
        raise EditError(
            f"remove.expectが現在値と一致しません: {pointer}（現在 {compact_json(current)}）"
        )
    if isinstance(parent, dict):
        del parent[segment]
    else:
        del parent[list_index(segment, len(parent))]
    add_change(changes, index, "remove", pointer, current, None)


def operation_summary(operation: dict[str, Any], index: int, change_count: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "index": index,
        "op": operation.get("op"),
        "changeCount": change_count,
    }
    for key in ("kind", "from", "to", "path"):
        if key in operation:
            result[key] = operation[key]
    return result


def apply_operations(
    document: Any,
    operations: Any,
    max_operations: int = DEFAULT_MAX_OPERATIONS,
    max_changes: int = DEFAULT_MAX_CHANGES,
) -> tuple[dict[str, Any], list[Change], list[dict[str, Any]]]:
    if not isinstance(document, dict):
        raise EditError("入力JSONのルートはオブジェクトにしてください")
    if not isinstance(operations, list):
        raise EditError("編集指定はoperations配列または配列そのものにしてください")
    if not operations:
        raise EditError("operationsが空です")
    if len(operations) > max_operations:
        raise EditError(f"操作数が上限{max_operations}件を超えています")
    result = to_plain(document)
    changes: list[Change] = []
    summaries: list[dict[str, Any]] = []
    handlers = {
        "renameId": apply_rename_id,
        "replacePath": apply_replace_path,
        "set": apply_set,
        "add": apply_add,
        "remove": apply_remove,
    }
    for index, operation in enumerate(operations, start=1):
        if not isinstance(operation, dict):
            raise EditError(f"operations[{index - 1}]はオブジェクトにしてください")
        name = operation.get("op")
        if name not in handlers:
            raise EditError(
                f"operations[{index - 1}].opはrenameId、replacePath、set、add、removeのいずれかにしてください"
            )
        before = len(changes)
        try:
            handlers[name](result, operation, index, changes)
        except EditError as error:
            raise EditError(f"操作{index} ({name})を適用できません: {error}") from error
        changed = len(changes) - before
        if changed == 0:
            raise EditError(f"操作{index} ({name})では何も変更されませんでした")
        if len(changes) > max_changes:
            raise EditError(f"変更箇所が上限{max_changes}件を超えています")
        summaries.append(operation_summary(operation, index, changed))
    return result, changes, summaries


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def unified_diff(before: Any, after: Any, before_name: str, after_name: str) -> str:
    return "".join(
        difflib.unified_diff(
            stable_json(to_plain(before)).splitlines(keepends=True),
            stable_json(after).splitlines(keepends=True),
            fromfile=before_name,
            tofile=after_name,
        )
    )


def render_text(report: dict[str, Any]) -> str:
    output = report["output"] or "書き込みなし（dry-run）"
    lines = [
        "Yuraive編集: 完了",
        f"入力: {report['input']}",
        f"出力: {output}",
        f"操作: {report['operationCount']}件 / 変更箇所: {report['changeCount']}件",
        "",
        "変更一覧:",
    ]
    for change in report["changes"]:
        before = compact_json(change["before"])
        after = compact_json(change["after"])
        lines.append(
            f"  [{change['operation']}] {change['action']} {change['path']}: {before} -> {after}"
        )
    lines.extend(("", "差分:", report["diff"].rstrip("\n")))
    return "\n".join(lines) + "\n"


def default_output_path(input_path: Path) -> Path:
    if input_path.suffix:
        return input_path.with_name(f"{input_path.stem}.edited{input_path.suffix}")
    return input_path.with_name(f"{input_path.name}.edited.json")


def atomic_write(path: Path, source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(source)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def exclusive_write(path: Path, source: str) -> None:
    """Create a new file without a check/write race that could overwrite it."""

    path.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with path.open("x", encoding="utf-8", newline="\n") as handle:
            created = True
            handle.write(source)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        if created:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        raise


def extract_operations(manifest: Any) -> Any:
    if isinstance(manifest, list):
        return manifest
    if isinstance(manifest, dict) and set(manifest).issubset({"operations"}):
        return manifest.get("operations")
    raise EditError("編集ファイルはoperationsだけを持つオブジェクト、または操作の配列にしてください")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Yuraive JSONへ上限付きの明示的な一括編集を適用し、変更一覧と統一差分を出します。"
            "既定では入力を上書きしません。"
        ),
        epilog=(
            "編集指定例: {\"operations\":[{\"op\":\"renameId\",\"kind\":\"node\","
            "\"from\":\"old\",\"to\":\"new\"},{\"op\":\"set\",\"path\":"
            "\"/metadata/displayName\",\"expect\":\"旧名\",\"value\":\"新名\"}]}\n"
            "対応操作: renameId, replacePath, set, add, remove。set/removeは現在値のexpectが必須です。\n"
            "終了コード: 0=成功、2=引数・入出力・編集指定エラー。編集後の形式検査は"
            "inspect_yuraive.pyを別途実行してください。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="編集元の *.yuraive.json")
    parser.add_argument("--edits", required=True, type=Path, help="operationsを記述したJSONファイル")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--output", type=Path, help="編集後JSONの保存先（既定: *.edited.json）")
    destination.add_argument(
        "--in-place",
        action="store_true",
        help="入力を明示的に上書きする（既定では .bak バックアップを作成）",
    )
    parser.add_argument("--no-backup", action="store_true", help="--in-place時のバックアップを作成しない")
    parser.add_argument("--force", action="store_true", help="既存の出力またはバックアップを上書きする")
    parser.add_argument("--dry-run", action="store_true", help="ファイルを書き込まず変更内容と差分だけを表示する")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="差分レポート形式（既定: text）")
    parser.add_argument(
        "--max-operations",
        type=int,
        default=DEFAULT_MAX_OPERATIONS,
        help=f"受け付ける操作数の上限（既定: {DEFAULT_MAX_OPERATIONS}、最大: {HARD_MAX_OPERATIONS}）",
    )
    parser.add_argument(
        "--max-changes",
        type=int,
        default=DEFAULT_MAX_CHANGES,
        help=f"参照更新を含む変更箇所の上限（既定: {DEFAULT_MAX_CHANGES}、最大: {HARD_MAX_CHANGES}）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.no_backup and not args.in_place:
        parser.error("--no-backupは--in-placeと一緒に指定してください")
    if not 1 <= args.max_operations <= HARD_MAX_OPERATIONS:
        parser.error(f"--max-operationsは1〜{HARD_MAX_OPERATIONS}にしてください")
    if not 1 <= args.max_changes <= HARD_MAX_CHANGES:
        parser.error(f"--max-changesは1〜{HARD_MAX_CHANGES}にしてください")
    if not args.input.is_file():
        parser.error(f"入力ファイルが見つかりません: {args.input}")
    if not args.edits.is_file():
        parser.error(f"編集ファイルが見つかりません: {args.edits}")
    try:
        input_source = args.input.read_text(encoding="utf-8")
        edit_source = args.edits.read_text(encoding="utf-8")
        document = loads_json(input_source)
        manifest = loads_json(edit_source)
        input_duplicates = duplicate_keys(document)
        edit_duplicates = duplicate_keys(manifest)
        if input_duplicates:
            raise EditError("入力JSONに重複キーがあるため安全に編集できません。先に重複を解消してください")
        if edit_duplicates:
            raise EditError("編集指定JSONに重複キーがあります")
        operations = extract_operations(manifest)
        result, changes, summaries = apply_operations(
            document,
            operations,
            max_operations=args.max_operations,
            max_changes=args.max_changes,
        )
        output_source = stable_json(result)
        if len(output_source.encode("utf-8")) > HARD_MAX_OUTPUT_BYTES:
            raise EditError(f"編集後JSONが安全上限{HARD_MAX_OUTPUT_BYTES}バイトを超えています")
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        print(f"編集できません: {error}", file=sys.stderr)
        return EXIT_USAGE

    output_path = args.input if args.in_place else (args.output or default_output_path(args.input))
    if not args.in_place and output_path.resolve() == args.input.resolve():
        print("編集できません: 入力と同じパスへ書くには--in-placeを指定してください", file=sys.stderr)
        return EXIT_USAGE
    if not args.dry_run:
        if output_path.exists() and not args.in_place and not args.force:
            print(f"編集できません: 出力先が既に存在します: {output_path}（--forceで上書き）", file=sys.stderr)
            return EXIT_USAGE
        if args.in_place and not args.no_backup:
            backup = Path(f"{args.input}.bak")
            if backup.exists() and not args.force:
                print(f"編集できません: バックアップが既に存在します: {backup}（--forceで上書き）", file=sys.stderr)
                return EXIT_USAGE
            try:
                shutil.copy2(args.input, backup)
            except OSError as error:
                print(f"編集できません: バックアップを作成できません: {error}", file=sys.stderr)
                return EXIT_USAGE
        try:
            if not args.in_place and not args.force:
                exclusive_write(output_path, output_source)
            else:
                atomic_write(output_path, output_source)
        except OSError as error:
            print(f"編集できません: 出力を書き込めません: {error}", file=sys.stderr)
            return EXIT_USAGE

    after_name = str(output_path) if not args.dry_run else f"{output_path} (dry-run)"
    diff = unified_diff(document, result, str(args.input), after_name)
    report = {
        "schemaVersion": 1,
        "input": str(args.input),
        "output": None if args.dry_run else str(output_path),
        "dryRun": bool(args.dry_run),
        "operationCount": len(summaries),
        "changeCount": len(changes),
        "operations": summaries,
        "changes": [change.as_dict() for change in changes],
        "diff": diff,
        "validationPerformed": False,
    }
    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    else:
        sys.stdout.write(render_text(report))
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
