import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import uuid

from app.main import app
from app.core.phone import normalize_phone, is_valid_phone
from app.services.incident_service import create_farmer_incident, get_or_create_farmer


class TestPhase3Suite(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    # ==========================================
    # Phone Normalization & Validation Tests
    # ==========================================
    def test_phone_normalization_standard_10_digits(self):
        self.assertEqual(normalize_phone("9876543210"), "+919876543210")

    def test_phone_normalization_with_spaces_and_plus(self):
        self.assertEqual(normalize_phone("+91 9876543210"), "+919876543210")

    def test_phone_normalization_with_hyphens(self):
        self.assertEqual(normalize_phone("+91-98765-43210"), "+919876543210")

    def test_phone_normalization_with_leading_zero(self):
        self.assertEqual(normalize_phone("09876543210"), "+919876543210")

    def test_phone_normalization_with_91_prefix(self):
        self.assertEqual(normalize_phone("919876543210"), "+919876543210")

    def test_phone_normalization_with_parentheses(self):
        self.assertEqual(normalize_phone("(+91) 9876543210"), "+919876543210")

    def test_phone_validation_rejects_invalid_numbers(self):
        invalid_numbers = [
            "12345",
            "98765",
            "abcdefghij",
            "1234567890", # Indian mobile doesn't start with 1
            "0000000000",
            "",
            None,
        ]
        for num in invalid_numbers:
            self.assertFalse(is_valid_phone(num), f"Should have rejected {num}")
            with self.assertRaises(ValueError):
                normalize_phone(num)

    # ==========================================
    # Phase 3 Required Submission Flow Tests
    # ==========================================
    @patch("app.services.incident_service.get_supabase_client")
    def test_1_new_farmer_and_new_incident(self, mock_get_supabase):
        """TEST 1: New farmer + new incident -> creates farmer, creates incident with status=NEW, priority=LOW"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        # Mock: farmer not found
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = []
        
        # Mock: farmer creation
        new_farmer_id = str(uuid.uuid4())
        mock_farmers_table.insert.return_value.execute.return_value.data = [{
            "id": new_farmer_id,
            "name": "Ravi Kumar",
            "phone": "+919876543210",
        }]

        # Mock: incident creation
        new_incident_id = str(uuid.uuid4())
        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": new_incident_id,
            "farmer_id": new_farmer_id,
            "description": "Chilli leaves are curling with white spots.",
            "crop": "Chilli",
            "status": "NEW",
            "priority": "LOW",
            "cluster_id": None,
            "assigned_aeo_id": None,
            "location": "POINT(78.4867 17.3850)",
            "location_source": "GPS",
            "photo_url": "https://supabase.co/storage/photos/leaf.jpg",
        }]

        def table_router(table_name):
            if table_name == "farmers":
                return mock_farmers_table
            elif table_name == "incidents":
                return mock_incidents_table
            return MagicMock()

        mock_db.table.side_effect = table_router

        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi Kumar",
                "farmer_phone": "9876543210",
                "description": "Chilli leaves are curling with white spots.",
                "crop": "Chilli",
                "latitude": 17.3850,
                "longitude": 78.4867,
                "photo_url": "https://supabase.co/storage/photos/leaf.jpg",
            }
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["farmer_id"], new_farmer_id)
        self.assertEqual(data["incident_id"], new_incident_id)
        self.assertTrue(data["reference_id"].startswith("RB-"))

    @patch("app.services.incident_service.get_supabase_client")
    def test_2_existing_farmer_second_incident(self, mock_get_supabase):
        """TEST 2: Existing farmer + second incident -> reuses farmer.id, creates new incident"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        existing_farmer_id = str(uuid.uuid4())
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": existing_farmer_id,
            "name": "Ravi Kumar",
            "phone": "+919876543210",
        }]

        second_incident_id = str(uuid.uuid4())
        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": second_incident_id,
            "farmer_id": existing_farmer_id,
            "description": "White insects appearing under leaves.",
            "crop": "Chilli",
            "status": "NEW",
            "priority": "LOW",
            "cluster_id": None,
            "assigned_aeo_id": None,
        }]

        def table_router(table_name):
            if table_name == "farmers":
                return mock_farmers_table
            elif table_name == "incidents":
                return mock_incidents_table
            return MagicMock()

        mock_db.table.side_effect = table_router

        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi Kumar",
                "farmer_phone": "9876543210",
                "description": "White insects appearing under leaves.",
                "crop": "Chilli",
            }
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["success"])
        # Must reuse the existing farmer ID
        self.assertEqual(data["farmer_id"], existing_farmer_id)
        self.assertEqual(data["incident_id"], second_incident_id)
        # Farmer insert must NOT be called
        mock_farmers_table.insert.assert_not_called()

    @patch("app.services.incident_service.get_supabase_client")
    def test_3_different_phone_formatting_resolves_to_same_farmer(self, mock_get_supabase):
        """TEST 3: Same phone number with different formatting resolves to the same farmer"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        existing_farmer_id = "farmer-uuid-12345"
        mock_farmers_table = MagicMock()
        # Returns existing farmer when searched with normalized phone +919876543210
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": existing_farmer_id,
            "name": "Ravi",
            "phone": "+919876543210",
        }]

        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": "incident-uuid-999",
            "farmer_id": existing_farmer_id,
            "description": "Plants are becoming weak.",
            "status": "NEW",
            "priority": "LOW",
        }]

        mock_db.table.side_effect = lambda t: mock_farmers_table if t == "farmers" else mock_incidents_table

        # Format variant 1: "+91 98765 43210"
        res1 = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi",
                "farmer_phone": "+91 98765 43210",
                "description": "Plants are becoming weak.",
            }
        )
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(res1.json()["farmer_id"], existing_farmer_id)
        # Checked with normalized phone
        mock_farmers_table.select.return_value.eq.assert_called_with("phone", "+919876543210")

        # Format variant 2: "+91-98765-43210"
        res2 = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi",
                "farmer_phone": "+91-98765-43210",
                "description": "Plants are becoming weak.",
            }
        )
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.json()["farmer_id"], existing_farmer_id)

    def test_4_invalid_phone_returns_error(self):
        """TEST 4: Invalid phone returns validation error"""
        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi",
                "farmer_phone": "12345",
                "description": "Leaves are turning yellow",
            }
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("detail", data)
        self.assertIn("valid 10-digit mobile number", str(data["detail"]))

    def test_5_missing_description_returns_error(self):
        """TEST 5: Missing description returns validation error"""
        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Ravi",
                "farmer_phone": "9876543210",
                "description": "",
            }
        )
        self.assertIn(response.status_code, [400, 422])

    @patch("app.services.incident_service.get_supabase_client")
    def test_6_incident_without_gps_accepted(self, mock_get_supabase):
        """TEST 6: Incident without GPS is accepted with location=NULL, location_source=UNKNOWN"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        farmer_id = str(uuid.uuid4())
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id,
            "name": "Suresh",
            "phone": "+919876543210",
        }]

        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": str(uuid.uuid4()),
            "farmer_id": farmer_id,
            "description": "Paddy crop has brown spots",
            "location": None,
            "location_source": "UNKNOWN",
            "status": "NEW",
            "priority": "LOW",
        }]

        mock_db.table.side_effect = lambda t: mock_farmers_table if t == "farmers" else mock_incidents_table

        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Suresh",
                "farmer_phone": "9876543210",
                "description": "Paddy crop has brown spots",
                "latitude": None,
                "longitude": None,
            }
        )

        self.assertEqual(response.status_code, 201)
        # Check payload sent to incidents insert
        insert_args = mock_incidents_table.insert.call_args[0][0]
        self.assertIsNone(insert_args["location"])
        self.assertEqual(insert_args["location_source"], "UNKNOWN")

    @patch("app.services.incident_service.get_supabase_client")
    def test_7_incident_without_photo_accepted(self, mock_get_supabase):
        """TEST 7: Incident without photo is accepted"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        farmer_id = str(uuid.uuid4())
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id,
            "name": "Suresh",
            "phone": "+919876543210",
        }]

        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": str(uuid.uuid4()),
            "farmer_id": farmer_id,
            "description": "Paddy crop has brown spots",
            "photo_url": None,
            "status": "NEW",
            "priority": "LOW",
        }]

        mock_db.table.side_effect = lambda t: mock_farmers_table if t == "farmers" else mock_incidents_table

        response = self.client.post(
            "/api/v1/incidents",
            json={
                "farmer_name": "Suresh",
                "farmer_phone": "9876543210",
                "description": "Paddy crop has brown spots",
                "photo_url": None,
            }
        )

        self.assertEqual(response.status_code, 201)
        insert_args = mock_incidents_table.insert.call_args[0][0]
        self.assertIsNone(insert_args["photo_url"])

    @patch("app.services.incident_service.upload_incident_photo")
    @patch("app.services.incident_service.get_supabase_client")
    def test_8_multipart_form_with_photo_file(self, mock_get_supabase, mock_upload_photo):
        """TEST 8: Multipart form data with photo file upload"""
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db
        mock_upload_photo.return_value = "https://supabase.co/storage/photos/uploaded_leaf.jpg"

        farmer_id = str(uuid.uuid4())
        mock_farmers_table = MagicMock()
        mock_farmers_table.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": farmer_id,
            "name": "Ramesh",
            "phone": "+919876543210",
        }]

        mock_incidents_table = MagicMock()
        mock_incidents_table.insert.return_value.execute.return_value.data = [{
            "id": str(uuid.uuid4()),
            "farmer_id": farmer_id,
            "description": "Leaf spots observed",
            "photo_url": "https://supabase.co/storage/photos/uploaded_leaf.jpg",
            "status": "NEW",
            "priority": "LOW",
        }]

        mock_db.table.side_effect = lambda t: mock_farmers_table if t == "farmers" else mock_incidents_table

        response = self.client.post(
            "/api/v1/incidents/upload",
            data={
                "farmer_name": "Ramesh",
                "farmer_phone": "9876543210",
                "description": "Leaf spots observed",
                "crop": "Cotton",
                "language": "Telugu",
                "latitude": "17.4000",
                "longitude": "78.5000",
            },
            files={
                "photo": ("leaf.jpg", b"fake-jpeg-bytes", "image/jpeg")
            }
        )

        self.assertEqual(response.status_code, 201)
        mock_upload_photo.assert_called_once()
        insert_args = mock_incidents_table.insert.call_args[0][0]
        self.assertEqual(insert_args["photo_url"], "https://supabase.co/storage/photos/uploaded_leaf.jpg")
        self.assertEqual(insert_args["location"], "POINT(78.5 17.4)")
        self.assertEqual(insert_args["location_source"], "GPS")


if __name__ == "__main__":
    unittest.main()

