"""Small JSON helpers shared by the distributable Yuraive tools.

This module deliberately uses only the Python standard library so the scripts can
run unchanged in a local Skill or in Custom GPT Code Interpreter.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class DuplicateAwareDict(dict[str, Any]):
    """A dict which remembers keys repeated in its JSON object."""

    def __init__(self, pairs: list[tuple[str, Any]]) -> None:
        super().__init__()
        self.duplicate_keys: list[str] = []
        for key, value in pairs:
            if key in self:
                self.duplicate_keys.append(key)
            self[key] = value


def _reject_non_json_number(value: str) -> None:
    raise ValueError(f"JSONでは使用できない数値です: {value}")


def loads_json(source: str) -> Any:
    """Parse strict JSON while retaining duplicate object-key information."""

    return json.loads(
        source,
        object_pairs_hook=DuplicateAwareDict,
        parse_constant=_reject_non_json_number,
    )


def read_json(path: Path) -> tuple[str, Any]:
    source = path.read_text(encoding="utf-8")
    return source, loads_json(source)


def pointer_escape(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def pointer_join(base: str, value: str | int) -> str:
    return f"{base}/{pointer_escape(str(value))}"


def duplicate_keys(value: Any, path: str = "") -> list[tuple[str, str]]:
    """Return (object pointer, repeated key) pairs in document order."""

    found: list[tuple[str, str]] = []
    if isinstance(value, DuplicateAwareDict):
        found.extend((path, key) for key in value.duplicate_keys)
    if isinstance(value, dict):
        for key, child in value.items():
            found.extend(duplicate_keys(child, pointer_join(path, key)))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(duplicate_keys(child, pointer_join(path, index)))
    return found


def to_plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: to_plain(child) for key, child in value.items()}
    if isinstance(value, list):
        return [to_plain(child) for child in value]
    return value


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def is_json_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, bool, int, float))


def json_equal(left: Any, right: Any) -> bool:
    """Compare JSON values without treating true as the number 1."""

    if type(left) is not type(right):
        return False
    return left == right
