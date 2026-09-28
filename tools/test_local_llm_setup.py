"""Focused offline tests for the local llama.cpp setup helper."""

from __future__ import annotations

import json
import tempfile
import unittest
import py_compile
from pathlib import Path

from tools import local_llm_setup as setup


class RecommendationTests(unittest.TestCase):
    def test_tiers_use_dedicated_vram_thresholds(self) -> None:
        gib = 1024**3
        self.assertIsNone(setup.recommended_tier(None))
        self.assertIsNone(setup.recommended_tier(3 * gib + gib // 2))
        self.assertEqual(setup.recommended_tier(int(3.99 * gib)), 4)
        self.assertEqual(setup.recommended_tier(int(7.99 * gib)), 9)
        self.assertEqual(setup.recommended_tier(int(11.99 * gib)), 12)
        self.assertEqual(setup.recommended_tier(int(23.99 * gib)), 27)
        self.assertEqual(setup.eligible_tiers(16 * gib), [4, 9, 12])

    def test_reported_shared_memory_does_not_create_dedicated_tier(self) -> None:
        mac = setup.Hardware("Darwin", "arm64", ram_bytes=16 * 1024**3, apple_unified_memory_bytes=16 * 1024**3)
        self.assertIsNone(setup.recommended_tier(mac.dedicated_vram_bytes))

    def test_hardware_size_parser_handles_rocm_shapes(self) -> None:
        self.assertEqual(setup._read_hardware_bytes({"card0": {"VRAM Total Memory (B)": "17179869184"}}), 16 * 1024**3)
        self.assertEqual(setup._read_hardware_bytes({"VRAM Total Memory (MiB)": 8192}), 8 * 1024**3)

    def test_launcher_is_created_as_valid_python_without_downloading_weights(self) -> None:
        config = {"slug": "test-model", "name": "Test", "repo": "sample/model", "file": "m-Q4_K_M.gguf"}
        with tempfile.TemporaryDirectory() as temporary:
            launcher = setup.write_launcher(config, Path(temporary))
            py_compile.compile(str(launcher), doraise=True)
            self.assertEqual(launcher.name, "test-model.py")
            self.assertFalse(Path(temporary, "cache").exists())


class HuggingFaceResolutionTests(unittest.TestCase):
    def test_resolves_q4_file_and_lfs_sha_from_api(self) -> None:
        payload = [{
            "path": "gguf/model-Q4_K_M.gguf",
            "size": 1234,
            "lfs": {"oid": "a" * 64},
            "lastCommit": {"id": "deadbeef"},
        }]
        calls: list[str] = []

        def fetch(url: str) -> bytes:
            calls.append(url)
            return json.dumps(payload).encode()

        resolved = setup.resolve_q4_file("sample/model", fetch)
        self.assertEqual(resolved["file"], "gguf/model-Q4_K_M.gguf")
        self.assertEqual(resolved["size"], 1234)
        self.assertEqual(resolved["sha256"], "a" * 64)
        self.assertEqual(resolved["revision"], "deadbeef")
        self.assertIn("/api/models/sample/model/tree/main?recursive=true&expand=true", calls[0])
        self.assertIn("resolve/deadbeef/gguf/model-Q4_K_M.gguf", resolved["url"])

    def test_rejects_missing_q4_or_invalid_repo(self) -> None:
        with self.assertRaises(ValueError):
            setup.resolve_q4_file("https://example.invalid/model", lambda _: b"[]")
        with self.assertRaises(RuntimeError):
            setup.resolve_q4_file("sample/model", lambda _: b'[{"path":"model-Q5_K_M.gguf"}]')


if __name__ == "__main__":
    unittest.main()
