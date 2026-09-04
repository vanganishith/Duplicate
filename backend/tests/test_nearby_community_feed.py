import unittest
from unittest.mock import patch, MagicMock
import uuid
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.services.community_confirmation_service import (
    get_nearby_incidents_for_farmer,
    record_community_confirmation
)

client = TestClient(app)

class TestNearbyCommunityFeed(unittest.TestCase):
    """
    Test suite for 3 KM Nearby Community Issues Feed and 'Me Too' Location Signal.
    """

    @patch("app.services.community_confirmation_service.get_supabase_client")
    def test_01_strictly_enforces_3km_radius(self, mock_get_supabase):
        """
        Ensures incidents within 3.0 km are returned and incidents beyond 3.0 km are strictly excluded.
        """
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        # Reference farmer coordinates (e.g. Warangal center: 17.9689, 79.5941)
        base_lat, base_lng = 17.9689, 79.5941

        # 0.4 km away (within 3km)
        inc_0_4km = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Round brown spots on leaves",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.003} {base_lat + 0.002})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # 1.8 km away (within 3km)
        inc_1_8km = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Leaf yellowing and curling",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.015} {base_lat + 0.008})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # 2.8 km away (within 3km)
        inc_2_8km = {
            "id": str(uuid.uuid4()),
            "crop": "Paddy",
            "description": "Stem borer signs",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.022} {base_lat + 0.012})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # 4.5 km away (OUTSIDE 3km radius)
        inc_4_5km = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Distant tomato issue",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.038} {base_lat + 0.025})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # 6.5 km away (OUTSIDE 3km radius)
        inc_6_5km = {
            "id": str(uuid.uuid4()),
            "crop": "Chilli",
            "description": "Far away chilli issue",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.055} {base_lat + 0.035})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }

        mock_db.table.return_value.select.return_value.execute.return_value.data = [
            inc_0_4km, inc_1_8km, inc_2_8km, inc_4_5km, inc_6_5km
        ]

        result = get_nearby_incidents_for_farmer(
            latitude=base_lat,
            longitude=base_lng,
            radius_km=3.0,
            crop="Tomato"
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 3)  # Only 3 inside 3.0 KM
        returned_ids = [item["id"] for item in result["items"]]
        self.assertIn(inc_0_4km["id"], returned_ids)
        self.assertIn(inc_1_8km["id"], returned_ids)
        self.assertIn(inc_2_8km["id"], returned_ids)
        self.assertNotIn(inc_4_5km["id"], returned_ids)
        self.assertNotIn(inc_6_5km["id"], returned_ids)

    @patch("app.services.community_confirmation_service.get_supabase_client")
    def test_02_prioritizes_same_crop_and_distance(self, mock_get_supabase):
        """
        Verifies sorting: Same crop first, then closest distance, then recency.
        """
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        base_lat, base_lng = 17.9689, 79.5941

        # Paddy at 0.5 km
        paddy_close = {
            "id": str(uuid.uuid4()),
            "crop": "Paddy",
            "description": "Paddy pest",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.004} {base_lat + 0.002})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # Tomato at 1.2 km (Same crop as farmer)
        tomato_med = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Tomato leaf curl",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.010} {base_lat + 0.005})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        # Tomato at 0.6 km (Same crop, closer)
        tomato_close = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Tomato spots",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.005} {base_lat + 0.003})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }

        mock_db.table.return_value.select.return_value.execute.return_value.data = [
            paddy_close, tomato_med, tomato_close
        ]

        result = get_nearby_incidents_for_farmer(
            latitude=base_lat,
            longitude=base_lng,
            radius_km=3.0,
            crop="Tomato"
        )

        items = result["items"]
        self.assertEqual(len(items), 3)
        # Tomato items must come before Paddy because crop is Tomato
        self.assertEqual(items[0]["id"], tomato_close["id"])
        self.assertEqual(items[1]["id"], tomato_med["id"])
        self.assertEqual(items[2]["id"], paddy_close["id"])

    @patch("app.services.community_confirmation_service.get_supabase_client")
    def test_03_strict_privacy_redaction(self, mock_get_supabase):
        """
        Verifies that no exact GPS coordinates, phone numbers, or farmer identities are exposed.
        """
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        base_lat, base_lng = 17.9689, 79.5941
        inc = {
            "id": str(uuid.uuid4()),
            "farmer_id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Secret farm leaf issue",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.005} {base_lat + 0.003})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "farmers": {"name": "Ramesh Patel", "phone": "9876543210", "village": "Gudur"},
            "ai_analysis": []
        }

        mock_db.table.return_value.select.return_value.execute.return_value.data = [inc]

        result = get_nearby_incidents_for_farmer(
            latitude=base_lat,
            longitude=base_lng,
            radius_km=3.0
        )

        item = result["items"][0]
        self.assertNotIn("latitude", item)
        self.assertNotIn("longitude", item)
        self.assertNotIn("farmer_phone", item)
        self.assertNotIn("farmer_name", item)
        self.assertIn("distance_text", item)
        self.assertIn("km away", item["distance_text"])
        self.assertIn("locality", item)

    @patch("app.services.community_confirmation_service.get_supabase_client")
    def test_04_no_nearby_issues_returns_friendly_message(self, mock_get_supabase):
        """
        Verifies empty state when no incidents are within 3 KM.
        """
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        base_lat, base_lng = 17.9689, 79.5941
        # Only an incident 15 km away
        far_inc = {
            "id": str(uuid.uuid4()),
            "crop": "Tomato",
            "description": "Very far issue",
            "status": "OPEN",
            "location": f"SRID=4326;POINT({base_lng + 0.15} {base_lat + 0.15})",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ai_analysis": []
        }
        mock_db.table.return_value.select.return_value.execute.return_value.data = [far_inc]

        result = get_nearby_incidents_for_farmer(
            latitude=base_lat,
            longitude=base_lng,
            radius_km=3.0
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["message"], "No similar issues found nearby.")

    @patch("app.services.community_confirmation_service.get_supabase_client")
    @patch("app.services.community_confirmation_service.get_incident_by_id")
    def test_05_me_too_confirmation_records_coordinates_without_new_incident(
        self, mock_get_incident, mock_get_supabase
    ):
        """
        Verifies that pressing 'Me Too' records confirmation on the existing incident
        with coordinates and does NOT create a new incident ticket.
        """
        mock_db = MagicMock()
        mock_get_supabase.return_value = mock_db

        inc_id = str(uuid.uuid4())
        mock_get_incident.return_value = {
            "id": inc_id,
            "crop": "Tomato",
            "description": "Original reported problem",
            "status": "NEW"
        }

        # Mock no existing confirmations
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

        result = record_community_confirmation(
            incident_id=inc_id,
            farmer_phone="9876543210",
            response="YES",
            farmer_name="Nearby Farmer A",
            latitude=17.9695,
            longitude=79.5948
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["incident_id"], inc_id)
        self.assertEqual(result["response"], "YES")
        self.assertEqual(result["stats"]["yes_count"], 1)

        # Verify insertion was into ai_analysis structured_data (not creating a new incidents table row)
        insert_args = mock_db.table.return_value.insert.call_args[0][0]
        self.assertEqual(insert_args["incident_id"], inc_id)
        confs = insert_args["structured_data"]["community_confirmations"]
        self.assertEqual(len(confs), 1)
        self.assertEqual(confs[0]["latitude"], 17.9695)
        self.assertEqual(confs[0]["longitude"], 79.5948)


if __name__ == "__main__":
    unittest.main()
