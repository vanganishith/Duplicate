import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestFarmerLookup(unittest.TestCase):

    @patch("app.api.v1.incidents.get_supabase_client")
    def test_lookup_existing_farmer(self, mock_get_client):
        mock_supabase = MagicMock()
        mock_get_client.return_value = mock_supabase

        mock_query = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Ramesh Kumar",
                "phone": "+919876543210",
                "preferred_language": "Telugu",
                "village": "Geesugonda",
                "district": "Warangal",
                "state": "Telangana"
            }]
        )

        response = client.get("/api/v1/farmers/lookup?phone=9876543210")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertTrue(data["exists"])
        self.assertEqual(data["farmer"]["name"], "Ramesh Kumar")
        self.assertEqual(data["farmer"]["phone"], "+919876543210")

    @patch("app.api.v1.incidents.get_supabase_client")
    def test_lookup_non_existing_farmer(self, mock_get_client):
        mock_supabase = MagicMock()
        mock_get_client.return_value = mock_supabase

        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[]
        )

        response = client.get("/api/v1/farmers/lookup?phone=9876543219")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertFalse(data["exists"])
        self.assertIsNone(data["farmer"])

    def test_lookup_invalid_phone(self):
        response = client.get("/api/v1/farmers/lookup?phone=12345")
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("Please enter a valid 10-digit mobile number.", str(data))
