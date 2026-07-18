#!/usr/bin/env python3
"""Inspect a Yuraive v1 JSON graph and its referenced content files."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter, deque
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

sys.dont_write_bytecode = True

from yuraive_json import duplicate_keys, loads_json, pointer_join


EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2
REPORT_SCHEMA_VERSION = 1


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    path: str = ""
    suggestion: str | None = None

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.path:
            result["path"] = self.path
        if self.suggestion:
            result["suggestion"] = self.suggestion
        return result


@dataclass
class AssetReference:
    path: str
    kinds: set[str] = field(default_factory=set)
    references: list[str] = field(default_factory=list)


class SlotParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.slots: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "slot":
            return
        attributes = {name.lower(): value or "" for name, value in attrs}
        self.slots.append(attributes.get("name") or attributes.get("id") or "")

    handle_startendtag = handle_starttag


class Inspector:
    def __init__(self, content_dir: Path | None, check_files: bool) -> None:
        self.content_dir = content_dir
        self.check_files = check_files
        self.issues: list[Issue] = []
        self.assets: dict[str, AssetReference] = {}
        self.layout_slots: dict[str, set[str]] = {}
        self.defined_transition_count = 0

    def add(
        self,
        severity: str,
        code: str,
        message: str,
        path: str = "",
        suggestion: str | None = None,
    ) -> None:
        self.issues.append(Issue(severity, code, message, path, suggestion))

    def structure_error(self, path: str, expected: str) -> None:
        label = path or "JSONのルート"
        self.add(
            "error",
            "invalid_structure",
            f"{label}は{expected}で指定してください。",
            path,
            "項目の型と入れ子をYuraive v1形式に合わせてください。",
        )

    def asset(self, value: Any, kind: str, path: str, required: bool = False) -> str | None:
        if value is None and not required:
            return None
        if not isinstance(value, str) or not value.strip():
            self.add(
                "error",
                "invalid_asset_path",
                f"{path}には空でない相対パスが必要です。",
                path,
                "コンテンツフォルダ内のファイルを / 区切りの相対パスで指定してください。",
            )
            return None
        reference = self.assets.setdefault(value, AssetReference(value))
        reference.kinds.add(kind)
        reference.references.append(path)
        extension_ok = (
            kind != "script"
            or value.lower().endswith(".star")
        ) and (
            kind != "layout"
            or value.lower().endswith(".yuraive-layout.html")
        ) and (kind != "subtitle" or value.lower().endswith(".vtt"))
        if not extension_ok:
            expected = {
                "script": ".star",
                "layout": ".yuraive-layout.html",
                "subtitle": ".vtt",
            }[kind]
            self.add(
                "error",
                "invalid_asset_extension",
                f"{value}は{expected}ファイルではありません。",
                path,
                f"{expected}拡張子のファイルを指定してください。",
            )
        return value

    def script_call(self, value: Any, path: str, required: bool = False) -> str | None:
        if value is None and not required:
            return None
        if not isinstance(value, dict):
            self.structure_error(path, "ScriptCallオブジェクト")
            return None
        script_path = self.asset(value.get("path"), "script", pointer_join(path, "path"), True)
        function = value.get("function")
        if "function" in value and (not isinstance(function, str) or not function.strip()):
            self.add(
                "error",
                "invalid_script_function",
                "スクリプトのfunctionは空でない文字列で指定してください。",
                pointer_join(path, "function"),
            )
        return script_path

    def transitions(
        self,
        value: Any,
        path: str,
        node_ids: set[str],
        owner_label: str,
    ) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            self.structure_error(path, "遷移の配列")
            return []
        enabled: list[str] = []
        has_positive = False
        self.defined_transition_count += len(value)
        for index, transition in enumerate(value):
            item_path = pointer_join(path, index)
            if not isinstance(transition, dict):
                self.structure_error(item_path, "遷移オブジェクト")
                continue
            target = transition.get("to")
            weight = transition.get("weight")
            if not isinstance(target, str) or not target:
                self.add(
                    "error",
                    "invalid_node_reference",
                    f"{owner_label}の遷移先IDが不正です。",
                    pointer_join(item_path, "to"),
                    "存在するノードIDを指定してください。",
                )
            elif target not in node_ids:
                self.add(
                    "error",
                    "invalid_node_reference",
                    f"{owner_label}の遷移先「{target}」が見つかりません。",
                    pointer_join(item_path, "to"),
                    "遷移先IDを修正するか、対象ノードを作成してください。",
                )
            if not is_finite_number(weight) or weight < 0:
                self.add(
                    "error",
                    "invalid_weight",
                    f"{owner_label}の重みは0以上の有限値にしてください。",
                    pointer_join(item_path, "weight"),
                )
            elif weight > 0:
                has_positive = True
                if isinstance(target, str) and target in node_ids:
                    enabled.append(target)
        if value and not has_positive:
            self.add(
                "error",
                "zero_weight_set",
                f"{owner_label}の遷移候補は重みがすべて0です。",
                path,
                "少なくとも1件のweightを0より大きくしてください。",
            )
        return enabled

    def inspect_graph(self, graph: Any) -> dict[str, Any]:
        empty_summary = graph_summary()
        if not isinstance(graph, dict):
            self.structure_error("", "オブジェクト")
            return empty_summary

        for object_path, key in duplicate_keys(graph):
            id_map = object_path in ("/nodes", "/buttons", "/playerControls")
            code = "duplicate_id" if id_map else "duplicate_json_key"
            noun = "ID" if id_map else "JSONキー"
            self.add(
                "error",
                code,
                f"{object_path or '/'}で{noun}「{key}」が重複しています。",
                pointer_join(object_path, key),
                "重複を解消してください。後に書かれた値だけが残る処理系があります。",
            )

        version = graph.get("version")
        if not is_integer(version) or version != 1:
            self.add(
                "error",
                "unsupported_version",
                "versionは数値の1で指定してください。",
                "/version",
                "Yuraive v1ではversionを1にします。",
            )

        maps: dict[str, dict[str, Any]] = {}
        for name in ("nodes", "buttons", "playerControls"):
            value = graph.get(name)
            if name not in graph:
                self.add(
                    "error",
                    "missing_required_field",
                    f"必須項目{name}がありません。",
                    f"/{name}",
                    f"トップレベルに{name}オブジェクトを追加してください。",
                )
                maps[name] = {}
            elif not isinstance(value, dict):
                self.structure_error(f"/{name}", "オブジェクト")
                maps[name] = {}
            else:
                maps[name] = value

        nodes = maps["nodes"]
        buttons = maps["buttons"]
        controls = maps["playerControls"]
        node_ids = set(nodes)
        button_ids = set(buttons)
        control_ids = set(controls)

        metadata = graph.get("metadata")
        if metadata is not None:
            if not isinstance(metadata, dict):
                self.structure_error("/metadata", "オブジェクト")
            else:
                self.validate_metadata(metadata)

        if "playbackStats" in graph:
            self.script_call(graph.get("playbackStats"), "/playbackStats", True)

        global_control = graph.get("globalPlayerControl")
        if "globalPlayerControl" in graph:
            if not isinstance(global_control, str) or not global_control:
                self.structure_error("/globalPlayerControl", "空でない再生設定IDの文字列")
            elif global_control not in control_ids:
                self.add(
                    "error",
                    "invalid_player_control_reference",
                    f"グローバル再生設定「{global_control}」が見つかりません。",
                    "/globalPlayerControl",
                    "playerControlsに設定を追加するか、既存の設定IDへ変更してください。",
                )

        node_on_end: dict[str, list[str]] = {}
        node_button_refs: dict[str, list[str]] = {}
        node_types: Counter[str] = Counter()
        terminal_nodes: set[str] = set()
        start_nodes: list[str] = []
        used_controls: set[str] = set()
        if isinstance(global_control, str) and global_control in control_ids:
            used_controls.add(global_control)

        for node_id, node in nodes.items():
            path = pointer_join("/nodes", node_id)
            if not node_id.strip():
                self.add("error", "empty_id", "空のノードIDは使用できません。", path)
            if not isinstance(node, dict):
                self.structure_error(path, "ノードオブジェクト")
                node_on_end[node_id] = []
                node_button_refs[node_id] = []
                continue
            node_type = node.get("type")
            if node_type not in ("media", "script"):
                self.add(
                    "error",
                    "invalid_node_type",
                    f"ノード「{node_id}」のtypeはmediaまたはscriptにしてください。",
                    pointer_join(path, "type"),
                )
            else:
                node_types[node_type] += 1
            start = node.get("start", False)
            if "start" in node and not isinstance(start, bool):
                self.structure_error(pointer_join(path, "start"), "真偽値")
            if start is True:
                start_nodes.append(node_id)
            terminal = node.get("terminal", False)
            if "terminal" in node and not isinstance(terminal, bool):
                self.structure_error(pointer_join(path, "terminal"), "真偽値")
            if terminal is True:
                terminal_nodes.add(node_id)

            node_on_end[node_id] = self.transitions(
                node.get("onEnd"), pointer_join(path, "onEnd"), node_ids, f"ノード「{node_id}」"
            )
            button_refs = node.get("buttons", [])
            if not isinstance(button_refs, list):
                self.structure_error(pointer_join(path, "buttons"), "ボタンIDの配列")
                button_refs = []
            clean_button_refs: list[str] = []
            seen_buttons: set[str] = set()
            for index, button_id in enumerate(button_refs):
                ref_path = pointer_join(pointer_join(path, "buttons"), index)
                if not isinstance(button_id, str) or not button_id:
                    self.structure_error(ref_path, "空でないボタンIDの文字列")
                    continue
                if button_id in seen_buttons:
                    self.add(
                        "error",
                        "duplicate_button_reference",
                        f"ノード「{node_id}」でボタン「{button_id}」が重複しています。",
                        ref_path,
                        "同じノードのbuttonsには同じIDを1回だけ指定してください。",
                    )
                seen_buttons.add(button_id)
                if button_id not in button_ids:
                    self.add(
                        "error",
                        "invalid_button_reference",
                        f"ノード「{node_id}」が参照するボタン「{button_id}」が見つかりません。",
                        ref_path,
                        "buttonsに定義を追加するか、既存のボタンIDへ変更してください。",
                    )
                else:
                    clean_button_refs.append(button_id)
            node_button_refs[node_id] = clean_button_refs

            player_control = node.get("playerControl")
            if "playerControl" in node:
                if not isinstance(player_control, str) or not player_control:
                    self.structure_error(pointer_join(path, "playerControl"), "空でない再生設定IDの文字列")
                elif player_control not in control_ids:
                    self.add(
                        "error",
                        "invalid_player_control_reference",
                        f"ノード「{node_id}」の再生設定「{player_control}」が見つかりません。",
                        pointer_join(path, "playerControl"),
                        "playerControlsに設定を追加するか、既存の設定IDへ変更してください。",
                    )
                else:
                    used_controls.add(player_control)

            if node_type == "script":
                self.validate_script_node(node_id, node, path)
            elif node_type == "media":
                self.validate_media_node(node_id, node, path, terminal is True)

            if terminal is True and (node.get("onEnd") or button_refs):
                self.add(
                    "error",
                    "terminal_has_output",
                    f"終端ノード「{node_id}」には遷移やボタンを設定できません。",
                    path,
                    "onEndとbuttonsを削除するか、terminalをfalseにしてください。",
                )

        if len(start_nodes) != 1:
            self.add(
                "error",
                "invalid_start_count",
                f"開始ノードは1件必要です（現在{len(start_nodes)}件）。",
                "/nodes",
                "1件のノードだけでstartをtrueにしてください。",
            )

        button_outgoing: dict[str, list[str]] = {}
        used_buttons = {button_id for refs in node_button_refs.values() for button_id in refs}
        for button_id, button in buttons.items():
            path = pointer_join("/buttons", button_id)
            if not button_id.strip():
                self.add("error", "empty_id", "空のボタンIDは使用できません。", path)
            if not isinstance(button, dict):
                self.structure_error(path, "ボタンオブジェクト")
                button_outgoing[button_id] = []
                continue
            button_outgoing[button_id] = self.transitions(
                button.get("onPress"),
                pointer_join(path, "onPress"),
                node_ids,
                f"ボタン「{button_id}」",
            )
            if button_id not in used_buttons:
                self.add(
                    "warning",
                    "unreferenced_button",
                    f"ボタン「{button_id}」はどのノードからも参照されていません。",
                    path,
                    "利用するノードのbuttonsへ追加するか、不要なら定義を削除してください。",
                )
            if "render" in button:
                self.script_call(button.get("render"), pointer_join(path, "render"), True)
            style = button.get("style")
            if style is not None:
                if not isinstance(style, dict):
                    self.structure_error(pointer_join(path, "style"), "オブジェクト")
                elif "backgroundImage" in style:
                    self.asset(
                        style.get("backgroundImage"),
                        "image",
                        pointer_join(pointer_join(path, "style"), "backgroundImage"),
                        True,
                    )
            self.validate_button_values(button_id, button, path)

        control_layouts: dict[str, str] = {}
        for control_id, control in controls.items():
            path = pointer_join("/playerControls", control_id)
            if not control_id.strip():
                self.add("error", "empty_id", "空の再生設定IDは使用できません。", path)
            if not isinstance(control, dict):
                self.structure_error(path, "再生設定オブジェクト")
                continue
            layout = control.get("layout")
            if "layout" in control:
                resolved = self.asset(layout, "layout", pointer_join(path, "layout"), True)
                if resolved:
                    control_layouts[control_id] = resolved
            for name in (
                "allowStop",
                "showSeekBar",
                "showPlaybackTime",
                "allowSeek",
                "showSceneName",
                "showFileName",
                "allowNext",
                "allowPrevious",
            ):
                if name in control and not isinstance(control[name], bool):
                    self.structure_error(pointer_join(path, name), "真偽値")
            accent = control.get("accentColor")
            if "accentColor" in control and (not isinstance(accent, str) or not safe_accent(accent)):
                self.add(
                    "error",
                    "invalid_accent_color",
                    f"再生設定「{control_id}」のaccentColorが使用できません。",
                    pointer_join(path, "accentColor"),
                    "白・黒に近すぎない#RRGGBB形式の色を指定してください。",
                )
            if control_id not in used_controls:
                self.add(
                    "warning",
                    "unreferenced_player_control",
                    f"再生設定「{control_id}」はどこからも参照されていません。",
                    path,
                    "globalPlayerControlまたはMedia NodeのplayerControlから参照してください。",
                )

        editor = graph.get("editor")
        if isinstance(editor, dict):
            layouts = editor.get("layouts")
            if isinstance(layouts, dict):
                for layout_path in layouts:
                    self.asset(layout_path, "layout", pointer_join("/editor/layouts", layout_path))

        asset_report = self.inspect_assets()
        self.validate_layouts(nodes, buttons, controls, node_button_refs, control_layouts, global_control)

        effective_edges: dict[str, list[str]] = {}
        for node_id in nodes:
            outgoing = list(node_on_end.get(node_id, []))
            for button_id in node_button_refs.get(node_id, []):
                outgoing.extend(button_outgoing.get(button_id, []))
            effective_edges[node_id] = outgoing

        start_set = set(start_nodes)
        for owner, targets in [
            *((f"ノード「{node_id}」", targets) for node_id, targets in node_on_end.items()),
            *((f"ボタン「{button_id}」", targets) for button_id, targets in button_outgoing.items()),
        ]:
            for target in targets:
                if target in start_set:
                    self.add(
                        "error",
                        "incoming_start_transition",
                        f"{owner}から開始ノード「{target}」へ戻る遷移があります。",
                        "/nodes",
                        "開始ノード以外を遷移先にしてください。",
                    )

        reachable = reachable_nodes(start_nodes, effective_edges)
        unreachable = sorted(node_ids - reachable)
        for node_id in unreachable:
            self.add(
                "warning",
                "unreachable_node",
                f"ノード「{node_id}」には開始ノードから到達できません。",
                pointer_join("/nodes", node_id),
                "正の重みを持つ遷移を接続するか、不要ならノードを削除してください。",
            )
        dead_ends = sorted(
            node_id
            for node_id in node_ids
            if node_id not in terminal_nodes and not effective_edges.get(node_id)
        )
        for node_id in dead_ends:
            self.add(
                "warning",
                "dead_end_node",
                f"終端ではないノード「{node_id}」から先へ進めません。",
                pointer_join("/nodes", node_id),
                "onEndまたは遷移を持つボタンを追加するか、終端ノードにしてください。",
            )

        missing_assets = sum(1 for asset in asset_report if asset["status"] != "ok") if self.check_files else 0
        return graph_summary(
            **{
                "version": version,
                "nodeCount": len(nodes),
                "mediaNodeCount": node_types["media"],
                "scriptNodeCount": node_types["script"],
                "buttonCount": len(buttons),
                "playerControlCount": len(controls),
                "startNodes": sorted(start_nodes),
                "terminalNodeCount": len(terminal_nodes),
                "definedTransitionCount": self.defined_transition_count,
                "effectiveEdgeCount": sum(len(targets) for targets in effective_edges.values()),
                "reachableNodeCount": len(reachable),
                "unreachableNodes": unreachable,
                "deadEndNodes": dead_ends,
                "assetCount": len(asset_report),
                "missingAssetCount": missing_assets,
            }
        )

    def validate_metadata(self, metadata: dict[str, Any]) -> None:
        thumbnail = metadata.get("thumbnail")
        if "thumbnail" in metadata:
            self.asset(thumbnail, "image", "/metadata/thumbnail", True)
        content_id = metadata.get("contentId")
        if "contentId" in metadata and (not isinstance(content_id, str) or not content_id.strip()):
            self.structure_error("/metadata/contentId", "空でない文字列")
        tags = metadata.get("tags")
        if tags is not None:
            if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
                self.structure_error("/metadata/tags", "文字列の配列")
            elif len(tags) != len(set(tags)):
                self.add(
                    "warning",
                    "duplicate_tag",
                    "metadata.tagsに重複があります。",
                    "/metadata/tags",
                    "同じタグは1回だけ指定してください。",
                )
        links = metadata.get("socialLinks")
        if links is not None:
            if not isinstance(links, list):
                self.structure_error("/metadata/socialLinks", "リンクオブジェクトの配列")
            else:
                for index, link in enumerate(links):
                    path = pointer_join("/metadata/socialLinks", index)
                    if not isinstance(link, dict):
                        self.structure_error(path, "リンクオブジェクト")
                        continue
                    if not isinstance(link.get("label"), str) or not link["label"].strip():
                        self.structure_error(pointer_join(path, "label"), "空でない文字列")
                    url = link.get("url")
                    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
                        self.add(
                            "error",
                            "invalid_social_url",
                            "socialLinksのurlはhttpまたはhttps URLにしてください。",
                            pointer_join(path, "url"),
                        )

    def validate_script_node(self, node_id: str, node: dict[str, Any], path: str) -> None:
        self.script_call(node.get("script"), pointer_join(path, "script"), True)
        if not isinstance(node.get("onEnd"), list) or not node.get("onEnd"):
            self.add(
                "error",
                "script_node_without_transition",
                f"Script Node「{node_id}」には1件以上のonEndが必要です。",
                pointer_join(path, "onEnd"),
            )
        if node.get("terminal") is True:
            self.add(
                "error",
                "terminal_script_node",
                f"Script Node「{node_id}」を終端にはできません。",
                pointer_join(path, "terminal"),
            )
        for forbidden in ("media", "buttons", "playerControl"):
            if forbidden in node:
                self.add(
                    "error",
                    "field_not_allowed",
                    f"Script Node「{node_id}」では{forbidden}を使用できません。",
                    pointer_join(path, forbidden),
                    f"{forbidden}を削除してください。",
                )

    def validate_media_node(
        self, node_id: str, node: dict[str, Any], path: str, terminal: bool
    ) -> None:
        if "script" in node:
            self.add(
                "error",
                "field_not_allowed",
                f"Media Node「{node_id}」ではscriptを使用できません。",
                pointer_join(path, "script"),
            )
        media = node.get("media", [])
        if not isinstance(media, list):
            self.structure_error(pointer_join(path, "media"), "メディア候補の配列")
            return
        seen_ids: set[str] = set()
        has_positive = False
        for index, candidate in enumerate(media):
            item_path = pointer_join(pointer_join(path, "media"), index)
            if not isinstance(candidate, dict):
                self.structure_error(item_path, "メディア候補オブジェクト")
                continue
            media_id = candidate.get("id")
            if not isinstance(media_id, str) or not media_id:
                self.structure_error(pointer_join(item_path, "id"), "空でないメディアIDの文字列")
            elif media_id in seen_ids:
                self.add(
                    "error",
                    "duplicate_id",
                    f"ノード「{node_id}」でメディアID「{media_id}」が重複しています。",
                    pointer_join(item_path, "id"),
                    "同じノード内のメディアIDを一意にしてください。",
                )
            if isinstance(media_id, str):
                seen_ids.add(media_id)
            weight = candidate.get("weight")
            if not is_finite_number(weight) or weight < 0:
                self.add(
                    "error",
                    "invalid_weight",
                    f"ノード「{node_id}」のメディア重みは0以上の有限値にしてください。",
                    pointer_join(item_path, "weight"),
                )
            elif weight > 0:
                has_positive = True
            source = candidate.get("source")
            if not isinstance(source, dict):
                self.structure_error(pointer_join(item_path, "source"), "メディアソースオブジェクト")
                continue
            source_path = pointer_join(item_path, "source")
            source_type = source.get("type")
            if source_type not in ("audio", "audioImage", "video"):
                self.add(
                    "error",
                    "invalid_media_source",
                    f"メディア「{media_id or index}」のtypeが不正です。",
                    pointer_join(source_path, "type"),
                    "audio、audioImage、videoのいずれかを指定してください。",
                )
            if source_type in ("audio", "audioImage"):
                self.asset(source.get("audio"), "audio", pointer_join(source_path, "audio"), True)
            if source_type == "audioImage":
                self.asset(source.get("image"), "image", pointer_join(source_path, "image"), True)
            if source_type == "video":
                self.asset(source.get("video"), "video", pointer_join(source_path, "video"), True)
            if "subtitle" in source:
                self.asset(source.get("subtitle"), "subtitle", pointer_join(source_path, "subtitle"), True)
            volume = source.get("volume")
            if "volume" in source and (not is_finite_number(volume) or not 0 <= volume <= 1):
                self.add(
                    "error",
                    "invalid_volume",
                    f"メディア「{media_id or index}」のvolumeは0〜1にしてください。",
                    pointer_join(source_path, "volume"),
                )
            if terminal and source.get("loop") is True:
                self.add(
                    "error",
                    "terminal_media_loop",
                    f"終端ノード「{node_id}」のメディアはloopをtrueにできません。",
                    pointer_join(source_path, "loop"),
                )
        if media and not has_positive:
            self.add(
                "error",
                "zero_weight_set",
                f"ノード「{node_id}」のメディア候補は重みがすべて0です。",
                pointer_join(path, "media"),
            )

    def validate_button_values(self, button_id: str, button: dict[str, Any], path: str) -> None:
        for name in ("order", "zIndex"):
            if name in button and not is_integer(button[name]):
                self.structure_error(pointer_join(path, name), "整数")
        ranges = button.get("visibility")
        if ranges is not None:
            if not isinstance(ranges, list):
                self.structure_error(pointer_join(path, "visibility"), "表示区間の配列")
            else:
                for index, value in enumerate(ranges):
                    range_path = pointer_join(pointer_join(path, "visibility"), index)
                    if not isinstance(value, dict):
                        self.structure_error(range_path, "表示区間オブジェクト")
                        continue
                    start = value.get("fromMs")
                    end = value.get("toMs")
                    valid = is_integer(start) and start >= 0
                    valid = valid and (end is None or (is_integer(end) and end >= start))
                    if not valid:
                        self.add(
                            "error",
                            "invalid_visibility_range",
                            f"ボタン「{button_id}」の表示区間が不正です。",
                            range_path,
                            "fromMsを0以上、toMsをnullまたはfromMs以上の整数にしてください。",
                        )

    def inspect_assets(self) -> list[dict[str, Any]]:
        report: list[dict[str, Any]] = []
        root: Path | None = None
        if self.check_files and self.content_dir is not None:
            root = self.content_dir.resolve()
        for path in sorted(self.assets):
            reference = self.assets[path]
            status = "unchecked"
            resolved: Path | None = None
            if not safe_relative_path(path):
                status = "unsafe"
                self.add(
                    "error",
                    "unsafe_asset_path",
                    f"コンテンツ外を参照するパスです: {path}",
                    reference.references[0],
                    "絶対パス、URL、\\、.、..を使わない相対パスへ変更してください。",
                )
            elif self.check_files and root is not None:
                candidate = root.joinpath(*path.split("/"))
                try:
                    resolved = candidate.resolve(strict=True)
                except (FileNotFoundError, OSError):
                    status = "missing"
                    self.add(
                        "error",
                        "missing_asset",
                        f"参照ファイルが見つかりません: {path}",
                        reference.references[0],
                        f"{path}をコンテンツフォルダへ追加するか、参照パスを修正してください。",
                    )
                else:
                    if not path_is_within(resolved, root):
                        status = "outside"
                        self.add(
                            "error",
                            "asset_outside_content",
                            f"シンボリックリンクがコンテンツ外を指しています: {path}",
                            reference.references[0],
                            "コンテンツフォルダ内の通常ファイルを参照してください。",
                        )
                    elif not resolved.is_file():
                        status = "notFile"
                        self.add(
                            "error",
                            "asset_not_file",
                            f"参照先がファイルではありません: {path}",
                            reference.references[0],
                        )
                    else:
                        status = "ok"
                        if "layout" in reference.kinds:
                            self.read_layout(path, resolved, reference.references[0])
            report.append(
                {
                    "path": path,
                    "kinds": sorted(reference.kinds),
                    "references": reference.references,
                    "status": status,
                }
            )
        self._asset_report = report
        return report

    def read_layout(self, path: str, resolved: Path, reference_path: str) -> None:
        try:
            source = resolved.read_text(encoding="utf-8")
        except (UnicodeError, OSError) as error:
            self.add(
                "error",
                "invalid_layout_file",
                f"レイアウト「{path}」をUTF-8で読めません: {error}",
                reference_path,
            )
            return
        parser = SlotParser()
        try:
            parser.feed(source)
            parser.close()
        except Exception as error:  # HTMLParser errors vary between Python versions.
            self.add(
                "error",
                "invalid_layout_file",
                f"レイアウト「{path}」を解析できません: {error}",
                reference_path,
            )
            return
        counts = Counter(parser.slots)
        self.layout_slots[path] = set(parser.slots)
        if counts[""] != 1:
            self.add(
                "error",
                "invalid_default_slot",
                f"レイアウト「{path}」のデフォルトslotは1件必要です（現在{counts['']}件）。",
                reference_path,
                "nameとidのないslotをちょうど1件にしてください。",
            )
        duplicates = sorted(name or "(default)" for name, count in counts.items() if count > 1)
        if duplicates:
            self.add(
                "error",
                "duplicate_layout_slot",
                f"レイアウト「{path}」でslotが重複しています: {', '.join(duplicates)}",
                reference_path,
                "slotのnameまたはidをファイル内で一意にしてください。",
            )

    def validate_layouts(
        self,
        nodes: dict[str, Any],
        buttons: dict[str, Any],
        controls: dict[str, Any],
        node_button_refs: dict[str, list[str]],
        control_layouts: dict[str, str],
        global_control: Any,
    ) -> None:
        for node_id, refs in node_button_refs.items():
            if not refs:
                continue
            node = nodes.get(node_id)
            if not isinstance(node, dict) or node.get("type") != "media":
                continue
            control_id = node.get("playerControl") or global_control
            layout_path = control_layouts.get(control_id) if isinstance(control_id, str) else None
            if not layout_path:
                self.add(
                    "error",
                    "missing_button_layout",
                    f"ボタンを使うノード「{node_id}」の再生設定にレイアウトがありません。",
                    pointer_join("/nodes", node_id),
                    "playerControlまたはglobalPlayerControlからlayout付きの再生設定を参照してください。",
                )
                continue
            slots = self.layout_slots.get(layout_path)
            if slots is None:
                continue
            for button_id in refs:
                button = buttons.get(button_id)
                if not isinstance(button, dict):
                    continue
                slot = button.get("targetSlot", "")
                if not isinstance(slot, str):
                    self.structure_error(pointer_join(pointer_join("/buttons", button_id), "targetSlot"), "文字列")
                elif slot.strip() not in slots:
                    display = slot.strip() or "(default)"
                    self.add(
                        "error",
                        "invalid_layout_slot_reference",
                        f"レイアウト「{layout_path}」にslot「{display}」がありません。",
                        pointer_join(pointer_join("/buttons", button_id), "targetSlot"),
                        "targetSlotをレイアウト内のslot名へ変更してください。",
                    )


def is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def safe_relative_path(path: str) -> bool:
    if not path or path.startswith("/") or "\\" in path or ":" in path:
        return False
    if any(ord(character) < 32 for character in path):
        return False
    return all(part not in ("", ".", "..") for part in path.split("/"))


def path_is_within(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath((str(path), str(root))) == str(root)
    except ValueError:
        return False


def safe_accent(color: str) -> bool:
    if len(color) != 7 or not color.startswith("#"):
        return False
    try:
        channels = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    except ValueError:
        return False
    linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in channels]
    luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    return 0.08 <= luminance <= 0.90


def reachable_nodes(starts: Iterable[str], edges: dict[str, list[str]]) -> set[str]:
    visited: set[str] = set()
    queue = deque(starts)
    while queue:
        node_id = queue.popleft()
        if node_id in visited:
            continue
        visited.add(node_id)
        queue.extend(target for target in edges.get(node_id, []) if target not in visited)
    return visited


def graph_summary(**values: Any) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "version": None,
        "nodeCount": 0,
        "mediaNodeCount": 0,
        "scriptNodeCount": 0,
        "buttonCount": 0,
        "playerControlCount": 0,
        "startNodes": [],
        "terminalNodeCount": 0,
        "definedTransitionCount": 0,
        "effectiveEdgeCount": 0,
        "reachableNodeCount": 0,
        "unreachableNodes": [],
        "deadEndNodes": [],
        "assetCount": 0,
        "missingAssetCount": 0,
    }
    defaults.update(values)
    return defaults


def inspect_source(
    source: str,
    source_name: str = "<memory>",
    content_dir: Path | None = None,
    check_files: bool = True,
) -> dict[str, Any]:
    inspector = Inspector(content_dir, check_files)
    try:
        graph = loads_json(source)
    except (json.JSONDecodeError, ValueError) as error:
        if isinstance(error, json.JSONDecodeError):
            path = f"line {error.lineno}, column {error.colno}"
            message = f"JSONを解析できません: {error.msg}（{path}）"
        else:
            message = f"JSONを解析できません: {error}"
        inspector.add(
            "error",
            "invalid_json",
            message,
            suggestion="JSONエディタで構文エラーを修正してから再検査してください。",
        )
        summary = graph_summary()
        assets: list[dict[str, Any]] = []
    else:
        summary = inspector.inspect_graph(graph)
        assets = getattr(inspector, "_asset_report", [])
    counts = Counter(issue.severity for issue in inspector.issues)
    return {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "ok": counts["error"] == 0,
        "input": source_name,
        "contentDirectory": str(content_dir) if content_dir is not None else None,
        "issueCounts": {"error": counts["error"], "warning": counts["warning"]},
        "summary": summary,
        "assets": assets,
        "issues": [issue.as_dict() for issue in inspector.issues],
    }


def render_text(report: dict[str, Any]) -> str:
    summary = report["summary"]
    counts = report["issueCounts"]
    status = "OK" if report["ok"] else "問題あり"
    start = ", ".join(summary["startNodes"]) or "なし"
    lines = [
        f"Yuraive検査: {status}",
        f"入力: {report['input']}",
        (
            f"グラフ: ノード {summary['nodeCount']}件 "
            f"(media {summary['mediaNodeCount']} / script {summary['scriptNodeCount']}), "
            f"ボタン {summary['buttonCount']}件, 再生設定 {summary['playerControlCount']}件"
        ),
        (
            f"開始: {start}, 到達可能 {summary['reachableNodeCount']}/{summary['nodeCount']}件, "
            f"実効遷移 {summary['effectiveEdgeCount']}件"
        ),
        (
            f"関連ファイル: {summary['assetCount']}件"
            + (
                f"（問題 {summary['missingAssetCount']}件）"
                if report["contentDirectory"] is not None
                else "（存在確認なし）"
            )
        ),
        f"検出: エラー {counts['error']}件 / 警告 {counts['warning']}件",
    ]
    if report["issues"]:
        lines.append("")
        for issue in report["issues"]:
            location = f" {issue['path']}" if issue.get("path") else ""
            lines.append(f"{issue['severity'].upper()} [{issue['code']}]{location}: {issue['message']}")
            if issue.get("suggestion"):
                lines.append(f"  修正案: {issue['suggestion']}")
    return "\n".join(lines) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Yuraive v1 JSONの構造・参照・到達性・関連ファイルを読み取り専用で検査します。",
        epilog=(
            "終了コード: 0=エラーなし、1=検査エラーあり、2=引数または入出力エラー。 "
            "例: python3 inspect_yuraive.py graph.yuraive.json --format json"
        ),
    )
    parser.add_argument("input", type=Path, help="検査する *.yuraive.json")
    parser.add_argument(
        "--content-dir",
        type=Path,
        help="関連ファイルを探すコンテンツフォルダ（既定: 入力JSONの親フォルダ）",
    )
    parser.add_argument("--skip-files", action="store_true", help="関連ファイルの存在確認だけを省略する")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="レポート形式（既定: text）")
    parser.add_argument("--output", type=Path, help="レポートの保存先（省略時は標準出力）")
    parser.add_argument("--force", action="store_true", help="既存のレポート出力ファイルを上書きする")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    input_path: Path = args.input
    if not input_path.is_file():
        parser.error(f"入力ファイルが見つかりません: {input_path}")
    content_dir = args.content_dir or input_path.parent
    if not args.skip_files and not content_dir.is_dir():
        parser.error(f"コンテンツフォルダが見つかりません: {content_dir}")
    try:
        source = input_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        print(f"入力ファイルを読めません: {error}", file=sys.stderr)
        return EXIT_USAGE
    report = inspect_source(
        source,
        source_name=str(input_path),
        content_dir=None if args.skip_files else content_dir,
        check_files=not args.skip_files,
    )
    rendered = (
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.format == "json"
        else render_text(report)
    )
    if args.output:
        if args.output.exists() and not args.force:
            print(f"出力先が既に存在します: {args.output}（--forceで上書き）", file=sys.stderr)
            return EXIT_USAGE
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        except OSError as error:
            print(f"レポートを書き込めません: {error}", file=sys.stderr)
            return EXIT_USAGE
    else:
        sys.stdout.write(rendered)
    return EXIT_OK if report["ok"] else EXIT_INVALID


if __name__ == "__main__":
    raise SystemExit(main())
