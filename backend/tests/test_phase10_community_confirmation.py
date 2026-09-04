import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.community_confirmation_service import (
    calculate_community_stats,
    check_incident_has_nearby_complaints,
    record_community_confirmation,
    get_incident_community_summary,
)


class TestPhase10CommunityConfirmation(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_calculate_community_stats_aggregation(self):
        confirmations = [
            {"farmer_phone": "+919876543210", "response": "YES"},
            {"farmer_phone": "+919876543211", "response": "YES"},
            {"farmer_phone": "+919876543212", "response": "NO"},
            {"farmer_phone": "+919876543213", "response": "NOT_SURE"},
        ]
        stats = calculate_community_stats(confirmations)
        self.assertEqual(stats["yes_count"], 2)
        self.assertEqual(stats["no_count"], 1)
        self.assertEqual(stats["not_sure_count"], 1)
        self.assertEqual(stats["total_responses"], 4)

    def test_calculate_community_stats_empty(self):
        stats = calculate_community_stats([])
        self.assertEqual(stats["yes_count"], 0)
        self.assertEqual(stats["no_count"], 0)
        self.assertEqual(stats["not_sure_count"], 0)
        self.assertEqual(stats["total_responses"], 0)

    def test_check_incident_has_nearby_complaints(self):
        incident = {
            "id": "inc-center",
            "location": "POINT(78.5000 17.4000)",
        }
        all_incidents = [
            incident,
            {"id": "inc-near-1", "location": "POINT(78.5010 17.4010)"},  # ~150m away
            {"id": "inc-far-1", "location": "POINT(79.5000 18.4000)"},   # ~150km away
        ]
        has_nearby, count = check_incident_has_nearby_complaints(incident, all_incidents, cluster_radius_km=7.5)
        self.assertTrue(has_nearby)
        self.assertEqual(count, 1)

    @patch("app.services.community_confirmation_service.get_supabase_client")
    @patch("app.services.community_confirmation_service.get_incident_by_id")
    def test_record_community_confirmation_success(self, mock_get_incident, mock_get_client):
        mock_get_incident.return_value = {"id": "inc-123", "crop": "Paddy"}
        
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # Mock empty existing ai_analysis
        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query
        
        # Mock farmer table
        mock_farmer_query = MagicMock()
        mock_farmer_query.execute.return_value = MagicMock(data=[{"id": "farmer-uuid"}])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_farmer_query
        
        res = record_community_confirmation(
            incident_id="inc-123",
            farmer_phone="+919876543210",
            response="YES",
            farmer_name="Venkat Rao"
        )
        
        self.assertTrue(res["success"])
        self.assertEqual(res["response"], "YES")
        self.assertEqual(res["stats"]["yes_count"], 1)
        self.assertEqual(res["stats"]["total_responses"], 1)

    @patch("app.services.community_confirmation_service.get_supabase_client")
    @patch("app.services.community_confirmation_service.get_incident_by_id")
    def test_prevent_duplicate_farmer_confirmation(self, mock_get_incident, mock_get_client):
        mock_get_incident.return_value = {"id": "inc-123", "crop": "Paddy"}
        
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # Mock existing confirmation with phone +919876543210
        existing_ai_row = {
            "id": "ai-row-1",
            "incident_id": "inc-123",
            "structured_data": {
                "community_confirmations": [
                    {
                        "farmer_phone": "+919876543210",
                        "response": "YES",
                        "created_at": "2026-09-02T10:00:00Z"
                    }
                ]
            }
        }
        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[existing_ai_row])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query

        # Attempting second submission by same farmer phone
        with self.assertRaises(ValueError) as ctx:
            record_community_confirmation(
                incident_id="inc-123",
                farmer_phone="+919876543210",
                response="NO",
            )
        self.assertIn("already submitted", str(ctx.exception))

    def test_invalid_response_type(self):
        with self.assertRaises(ValueError) as ctx:
            record_community_confirmation(
                incident_id="inc-123",
                farmer_phone="+919876543210",
                response="MAYBE_OUTBREAK",
            )
        self.assertIn("Response must be YES, NO, or NOT_SURE", str(ctx.exception))

    @patch("app.api.v1.incidents.record_community_confirmation")
    def test_api_submit_confirmation(self, mock_record):
        mock_record.return_value = {
            "success": True,
            "incident_id": "inc-100",
            "farmer_phone": "+919876543210",
            "response": "YES",
            "stats": {
                "yes_count": 1,
                "no_count": 0,
                "not_sure_count": 0,
                "total_responses": 1
            },
            "message": "Community confirmation recorded successfully.",
        }

        response = self.client.post(
            "/api/v1/incidents/inc-100/confirmations",
            json={
                "farmer_phone": "9876543210",
                "farmer_name": "Ramesh",
                "response": "YES"
            }
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["stats"]["yes_count"], 1)

    @patch("app.api.v1.incidents.get_incident_community_summary")
    def test_api_get_confirmations_summary(self, mock_summary):
        mock_summary.return_value = {
            "success": True,
            "incident_id": "inc-100",
            "stats": {
                "yes_count": 3,
                "no_count": 1,
                "not_sure_count": 0,
                "total_responses": 4
            },
            "has_nearby_complaints": True,
            "nearby_complaints_count": 3,
            "confirmations": [],
            "disclaimer": "Community confirmation represents supporting field evidence from nearby farmers, not a confirmed outbreak diagnosis."
        }

        response = self.client.get("/api/v1/incidents/inc-100/confirmations")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["stats"]["yes_count"], 3)
        self.assertTrue(data["has_nearby_complaints"])


if __name__ == "__main__":
    unittest.main()
