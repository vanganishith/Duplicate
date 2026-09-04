import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.incident_service import (
    get_next_valid_statuses,
    update_incident_workflow_status,
    get_incident_timeline,
    VALID_STATUS_TRANSITIONS
)


class TestPhase11CaseWorkflow(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_get_next_valid_statuses(self):
        self.assertEqual(set(get_next_valid_statuses("NEW")), {"ACKNOWLEDGED", "REJECTED"})
        self.assertEqual(set(get_next_valid_statuses("ACKNOWLEDGED")), {"INVESTIGATING", "REJECTED"})
        self.assertEqual(set(get_next_valid_statuses("INVESTIGATING")), {"ACTION_TAKEN", "ESCALATED", "REJECTED"})
        self.assertEqual(set(get_next_valid_statuses("ACTION_TAKEN")), {"RESOLVED", "ESCALATED", "INVESTIGATING"})
        self.assertEqual(set(get_next_valid_statuses("RESOLVED")), set())
        self.assertEqual(set(get_next_valid_statuses("REJECTED")), set())

    @patch("app.services.incident_service.get_supabase_client")
    @patch("app.services.incident_service.get_incident_by_id")
    def test_valid_status_transition_sequence(self, mock_get_incident, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # 1. NEW -> ACKNOWLEDGED
        mock_get_incident.return_value = {"id": "inc-wf-1", "status": "NEW"}
        mock_update_query = MagicMock()
        mock_update_query.execute.return_value = MagicMock(data=[{"id": "inc-wf-1", "status": "ACKNOWLEDGED"}])
        mock_client.table.return_value.update.return_value.eq.return_value = mock_update_query
        
        res_ack = update_incident_workflow_status("inc-wf-1", "ACKNOWLEDGED", note="Officer acknowledged complaint")
        self.assertTrue(res_ack["success"])
        self.assertEqual(res_ack["status"], "ACKNOWLEDGED")
        self.assertEqual(res_ack["previous_status"], "NEW")

        # 2. ACKNOWLEDGED -> INVESTIGATING
        mock_get_incident.return_value = {"id": "inc-wf-1", "status": "ACKNOWLEDGED"}
        mock_update_query.execute.return_value = MagicMock(data=[{"id": "inc-wf-1", "status": "INVESTIGATING"}])
        res_inv = update_incident_workflow_status("inc-wf-1", "INVESTIGATING", note="Visiting field today")
        self.assertTrue(res_inv["success"])
        self.assertEqual(res_inv["status"], "INVESTIGATING")

        # 3. INVESTIGATING -> ACTION_TAKEN
        mock_get_incident.return_value = {"id": "inc-wf-1", "status": "INVESTIGATING"}
        mock_update_query.execute.return_value = MagicMock(data=[{"id": "inc-wf-1", "status": "ACTION_TAKEN"}])
        res_act = update_incident_workflow_status("inc-wf-1", "ACTION_TAKEN", note="Advised bio-fungicide treatment")
        self.assertTrue(res_act["success"])
        self.assertEqual(res_act["status"], "ACTION_TAKEN")

        # 4. ACTION_TAKEN -> RESOLVED
        mock_get_incident.return_value = {"id": "inc-wf-1", "status": "ACTION_TAKEN"}
        mock_update_query.execute.return_value = MagicMock(data=[{"id": "inc-wf-1", "status": "RESOLVED"}])
        res_res = update_incident_workflow_status("inc-wf-1", "RESOLVED", note="Farmer confirmed leaf recovery")
        self.assertTrue(res_res["success"])
        self.assertEqual(res_res["status"], "RESOLVED")

    @patch("app.services.incident_service.get_supabase_client")
    @patch("app.services.incident_service.get_incident_by_id")
    def test_invalid_status_transition_raises_error(self, mock_get_incident, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # NEW cannot jump straight to RESOLVED
        mock_get_incident.return_value = {"id": "inc-wf-2", "status": "NEW"}
        with self.assertRaises(ValueError) as ctx:
            update_incident_workflow_status("inc-wf-2", "RESOLVED")
        self.assertIn("Invalid status transition", str(ctx.exception))

        # RESOLVED cannot transition anywhere
        mock_get_incident.return_value = {"id": "inc-wf-2", "status": "RESOLVED"}
        with self.assertRaises(ValueError) as ctx:
            update_incident_workflow_status("inc-wf-2", "INVESTIGATING")
        self.assertIn("Invalid status transition", str(ctx.exception))

    @patch("app.services.incident_service.get_supabase_client")
    def test_get_incident_timeline(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        incident_data = {
            "id": "inc-tl-1",
            "created_at": "2026-09-01T08:00:00Z",
            "description": "Chilli leaf spot report"
        }
        
        mock_ai_row = {
            "structured_data": {
                "timeline": [
                    {
                        "from_status": "NEW",
                        "to_status": "ACKNOWLEDGED",
                        "status": "ACKNOWLEDGED",
                        "label": "Acknowledged",
                        "note": "Case assigned to AEO",
                        "officer_id": "AEO001",
                        "timestamp": "2026-09-01T09:00:00Z"
                    }
                ]
            }
        }
        mock_ai_query = MagicMock()
        mock_ai_query.execute.return_value = MagicMock(data=[mock_ai_row])
        mock_client.table.return_value.select.return_value.eq.return_value = mock_ai_query
        
        timeline = get_incident_timeline("inc-tl-1", incident=incident_data)
        self.assertEqual(len(timeline), 2)
        self.assertEqual(timeline[0]["status"], "NEW")
        self.assertEqual(timeline[1]["status"], "ACKNOWLEDGED")

    @patch("app.api.v1.incidents.update_incident_workflow_status")
    def test_api_update_status_endpoint(self, mock_update):
        mock_update.return_value = {
            "success": True,
            "incident_id": "inc-100",
            "status": "INVESTIGATING",
            "note": "Field visit conducted",
            "message": "Incident transitioned to INVESTIGATING successfully."
        }

        response = self.client.post(
            "/api/v1/incidents/inc-100/status",
            json={
                "status": "INVESTIGATING",
                "note": "Field visit conducted",
                "officer_id": "AEO001"
            }
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["status"], "INVESTIGATING")


if __name__ == "__main__":
    unittest.main()
