import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app

class TestAeoWorkflowBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("app.api.v1.incidents.start_work_on_incident")
    def test_start_work_endpoint_success(self, mock_start_work):
        mock_start_work.return_value = {
            "success": True,
            "incident_id": "11111111-1111-1111-1111-111111111111",
            "status": "ACKNOWLEDGED",
            "acknowledged_at": "2026-09-02T12:00:00Z",
            "message": "Officer has started handling this complaint.",
            "incident": {"id": "11111111-1111-1111-1111-111111111111", "status": "ACKNOWLEDGED"}
        }

        response = self.client.post(
            "/api/v1/incidents/11111111-1111-1111-1111-111111111111/start-work",
            json={"officer_id": "AEO001"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["status"], "ACKNOWLEDGED")
        mock_start_work.assert_called_once_with(incident_id="11111111-1111-1111-1111-111111111111", officer_id="AEO001")

    @patch("app.api.v1.incidents.reject_incident")
    def test_reject_endpoint_success(self, mock_reject):
        mock_reject.return_value = {
            "success": True,
            "incident_id": "11111111-1111-1111-1111-111111111111",
            "status": "REJECTED",
            "rejection_reason": "Duplicate complaint",
            "rejected_at": "2026-09-02T12:05:00Z",
            "message": "Incident rejected successfully.",
            "incident": {"id": "11111111-1111-1111-1111-111111111111", "status": "REJECTED"}
        }

        response = self.client.post(
            "/api/v1/incidents/11111111-1111-1111-1111-111111111111/reject",
            json={"reason": "Duplicate complaint", "officer_id": "AEO001"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["status"], "REJECTED")
        self.assertEqual(data["rejection_reason"], "Duplicate complaint")
        mock_reject.assert_called_once_with(
            incident_id="11111111-1111-1111-1111-111111111111",
            reason="Duplicate complaint",
            officer_id="AEO001"
        )

    def test_reject_endpoint_empty_reason_fails(self):
        response = self.client.post(
            "/api/v1/incidents/11111111-1111-1111-1111-111111111111/reject",
            json={"reason": "   ", "officer_id": "AEO001"}
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertFalse(data.get("success", False))

if __name__ == "__main__":
    unittest.main()
