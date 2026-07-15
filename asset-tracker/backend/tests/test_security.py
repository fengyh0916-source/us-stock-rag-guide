import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app import auth
from app.main import app


class AssetTrackerSecurityTests(unittest.TestCase):
    def test_production_rejects_missing_auth_secret(self):
        with patch.dict(
            os.environ,
            {"ENVIRONMENT": "production", "AUTH_SECRET": "", "NEXTAUTH_SECRET": ""},
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                auth.validate_auth_configuration()

    def test_sensitive_ib_and_quote_routes_require_session_dependency(self):
        protected = {"/api/ib/status", "/api/ib/positions", "/api/quotes"}
        for route in app.routes:
            if getattr(route, "path", None) not in protected:
                continue
            dependencies = {
                dependency.call for dependency in route.dependant.dependencies
            }
            self.assertIn(auth.get_user_id_from_request, dependencies, route.path)

    def test_missing_cookie_is_rejected(self):
        request = Request({"type": "http", "headers": [], "method": "GET", "path": "/"})
        with self.assertRaises(HTTPException) as raised:
            auth.get_user_id_from_request(request, None)
        self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
