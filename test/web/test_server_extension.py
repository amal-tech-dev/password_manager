import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi import HTTPException

os.environ.setdefault("DEV_VAULT_INGEST_TOKEN", "test-ingest-token-" + "i" * 32)
os.environ.setdefault("DEV_VAULT_DASHBOARD_TOKEN", "test-dashboard-token-" + "d" * 32)
os.environ.setdefault("DEV_VAULT_EXTENSION_TOKEN", "test-extension-token-" + "e" * 32)
os.environ.setdefault("DEV_VAULT_FERNET_KEY", Fernet.generate_key().decode("ascii"))

import server


class BrowserExtensionApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_vault_file = server.VAULT_FILE
        server.VAULT_FILE = Path(self.temporary_directory.name) / "vault.enc"

    def tearDown(self):
        server.VAULT_FILE = self.original_vault_file
        self.temporary_directory.cleanup()

    def test_saves_login_with_extension_token(self):
        result = asyncio.run(
            server.save_extension_login(
                server.LoginRecord(
                    domain="example.com",
                    username="alice",
                    password="private-test-password",
                ),
                authorization=f"Bearer {server.EXTENSION_TOKEN}",
            )
        )

        self.assertEqual(result, {"ok": True, "result": "created"})
        matches = asyncio.run(
            server.get_extension_matches(
                domain="EXAMPLE.COM",
                authorization=f"Bearer {server.EXTENSION_TOKEN}",
            )
        )
        self.assertEqual(
            matches,
            {
                "domain": "example.com",
                "accounts": [
                    {"username": "alice", "password": "private-test-password"}
                ],
            },
        )

    def test_extension_match_api_returns_only_the_requested_domain(self):
        server.store_login(
            server.LoginRecord(
                domain="other.example",
                username="bob",
                password="another-private-test-password",
            )
        )

        matches = asyncio.run(
            server.get_extension_matches(
                domain="example.com",
                authorization=f"Bearer {server.EXTENSION_TOKEN}",
            )
        )

        self.assertEqual(matches["accounts"], [])

    def test_extension_api_rejects_invalid_and_unconfigured_tokens(self):
        with self.assertRaises(HTTPException) as invalid:
            asyncio.run(
                server.get_extension_matches(
                    domain="example.com",
                    authorization="Bearer incorrect",
                )
            )
        self.assertEqual(invalid.exception.status_code, 401)

        configured_token = server.EXTENSION_TOKEN
        try:
            server.EXTENSION_TOKEN = ""
            with self.assertRaises(HTTPException) as unconfigured:
                asyncio.run(
                    server.get_extension_matches(
                        domain="example.com",
                        authorization="Bearer " + "x" * 40,
                    )
                )
            self.assertEqual(unconfigured.exception.status_code, 503)
        finally:
            server.EXTENSION_TOKEN = configured_token


if __name__ == "__main__":
    unittest.main()
