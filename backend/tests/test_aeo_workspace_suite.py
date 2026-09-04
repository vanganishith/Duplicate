import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.incident_service import (
    compute_incident_priority_detail,
    get_government_support_options,
    get_aeo_analytics,
    get_aeo_notifications,
    officer_login_auth
)


class TestAeoWorkspaceSuite(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_officer_login_auth(self):
        # Test authenticating pre-seeded officer
        res = officer_login_auth("9876543210")
        self.assertTrue(res["success"])
        self.assertEqual(res["officer"]["name"], "Srinivas Rao")
        self.assertEqual(res["officer"]["role"], "AEO")

        # Test API endpoint
        resp = self.client.post("/api/v1/officers/login", json={"phone": "9876543210"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["officer"]["role"], "AEO")
        self.assertIn(data["officer"].get("officer_id", data["officer"].get("id")), ["AEO001", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"])

    def test_explainable_priority_scorecard(self):
        incident = {
            "id": "inc-test-prio",
            "created_at": "2026-09-04T10:00:00Z",
            "location": "POINT(78.5000 17.4000)",
            "description": "Severe infestation destroying entire crop",
            "priority": "HIGH",
            "ai_analysis": []
        }
        detail = compute_incident_priority_detail(incident, all_incidents=[incident])
        self.assertIn(detail["priority"], ["CRITICAL", "HIGH", "MEDIUM", "LOW"])
        self.assertIn("score", detail)
        self.assertIn("reasons", detail)
        self.assertIn("breakdown", detail)
        self.assertTrue(len(detail["breakdown"]) > 0)
        # Verify points breakdown structure
        for item in detail["breakdown"]:
            self.assertIn("signal", item)
            self.assertIn("points", item)
            self.assertIn("detail", item)

    @patch("app.services.incident_service.get_incident_by_id")
    def test_government_support_options(self, mock_get_incident):
        mock_get_incident.return_value = {
            "id": "inc-gov-1",
            "crop_type": "Cotton",
            "priority": "CRITICAL",
            "description": "Entire field devastated by heavy bollworm attack",
            "ai_analysis": [
                {
                    "preliminary_disease": "Pink Bollworm Infestation",
                    "structured_data": {"voice": {"problem": "Pink Bollworm"}}
                }
            ]
        }
        res = get_government_support_options("inc-gov-1")
        self.assertTrue(res["success"])
        schemes = res["schemes"]
        self.assertTrue(len(schemes) >= 3)
        scheme_names = [s["name"] for s in schemes]
        self.assertTrue(any("PMFBY" in name or "Fasal Bima" in name for name in scheme_names))
        self.assertTrue(any("Disaster" in name or "Relief" in name for name in scheme_names))
        self.assertTrue(any("NFSM" in name or "Plant Protection" in name for name in scheme_names))

        # Check PMFBY details
        pmfby = next(s for s in schemes if "PMFBY" in s["name"])
        self.assertTrue(pmfby["eligible"])
        self.assertIn("Aadhaar Card", pmfby["required_documents"])
        self.assertIn("72 hours", pmfby["claim_window"])

    @patch("app.services.incident_service.get_supabase_client")
    @patch("app.services.incident_service.get_incident_by_id")
    def test_aeo_verification_recording(self, mock_get_incident, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_incident.return_value = {"id": "inc-ver-1", "status": "NEW"}

        # Mock ai_analysis query
        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[{
            "id": "analysis-1",
            "structured_data": {"timeline": []}
        }])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query

        # Mock updates
        mock_update_query = MagicMock()
        mock_update_query.execute.return_value = MagicMock(data=[{"id": "inc-ver-1"}])
        mock_client.table.return_value.update.return_value.eq.return_value = mock_update_query

        payload = {
            "officer_id": "AEO001",
            "officer_name": "Srinivas Rao (AEO)",
            "status": "CONFIRMED",
            "confirmed_diagnosis": "Late Blight",
            "verified_severity": "HIGH",
            "official_advisory": "Apply Copper Oxychloride 3g/L immediately",
            "follow_up_instructions": "Check leaf undersides in 3 days",
            "officer_notes": "Observed water-soaked lesions across 0.5 acres"
        }

        resp = self.client.post("/api/v1/incidents/inc-ver-1/verify", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["verification"]["confirmed_diagnosis"], "Late Blight")
        self.assertEqual(data["verification"]["verified_severity"], "HIGH")

    @patch("app.services.incident_service.get_supabase_client")
    def test_case_communication_thread(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[{
            "id": "analysis-msg",
            "structured_data": {"communications": [], "timeline": []}
        }])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query
        mock_client.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{}])

        msg_payload = {
            "sender_type": "OFFICER",
            "sender_id": "AEO001",
            "sender_name": "Srinivas Rao (AEO)",
            "message": "Please ensure spray is applied during morning hours before 10 AM.",
            "message_type": "ADVISORY"
        }
        resp = self.client.post("/api/v1/incidents/inc-msg-1/messages", json=msg_payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["message"]["sender_type"], "OFFICER")
        self.assertIn("morning hours", data["message"]["message"])

    @patch("app.services.incident_service.get_supabase_client")
    @patch("app.services.incident_service.get_incident_by_id")
    def test_field_visit_scheduling(self, mock_get_incident, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_incident.return_value = {"id": "inc-vst-1", "status": "ACKNOWLEDGED"}

        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[{
            "id": "analysis-vst",
            "structured_data": {"field_visits": [], "timeline": [], "communications": []}
        }])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query
        mock_client.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{}])

        visit_payload = {
            "officer_id": "AEO001",
            "officer_name": "Srinivas Rao",
            "scheduled_date": "2026-09-06",
            "scheduled_time": "11:00 AM",
            "purpose": "Sample leaf collection and severity check",
            "farmer_notes": "Please come to north gate near canal"
        }
        resp = self.client.post("/api/v1/incidents/inc-vst-1/field-visits", json=visit_payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["visit"]["status"], "SCHEDULED")
        self.assertEqual(data["visit"]["scheduled_date"], "2026-09-06")

    @patch("app.services.incident_service.get_map_incidents_and_clusters")
    @patch("app.services.incident_service.get_aeo_field_visits")
    def test_aeo_analytics_overview(self, mock_visits, mock_map):
        mock_map.return_value = {
            "incidents": [
                {"id": "1", "crop": "Cotton", "area": "Narsampet"},
                {"id": "2", "crop": "Paddy", "area": "Geesugonda"},
            ],
            "clusters": [{"cluster_id": "cl-1", "incident_count": 4}],
            "summary": {
                "total": 2, "new": 1, "in_progress": 0, "resolved": 1, "rejected": 0, "high_priority": 1
            }
        }
        mock_visits.return_value = [{"id": "v1", "status": "SCHEDULED"}]

        analytics = get_aeo_analytics()
        self.assertTrue(analytics["success"])
        self.assertIn("kpis", analytics)
        kpis = analytics["kpis"]
        self.assertEqual(kpis["total_incidents"], 2)
        self.assertEqual(kpis["resolution_rate_percent"], 50.0)
        self.assertTrue(kpis["area_health_score"] >= 35)
        self.assertEqual(kpis["scheduled_visits_count"], 1)


if __name__ == "__main__":
    unittest.main()
