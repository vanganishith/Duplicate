import unittest
from datetime import datetime, timezone, timedelta
from app.services.incident_service import (
    compute_incident_priority,
    compute_cluster_priority,
)


class TestPrioritySystem(unittest.TestCase):

    def test_high_priority_multiple_signals(self):
        # Scenario: Multiple nearby complaints + recent reports
        now = datetime.now(timezone.utc)
        base_inc = {
            "id": "inc-center",
            "created_at": (now - timedelta(hours=5)).isoformat(),
            "location": "POINT(78.5000 17.4000)",
            "description": "Paddy crop yellowing",
            "ai_analysis": [],
        }

        # 4 nearby incidents within 2km
        nearby_incidents = [
            {
                "id": f"inc-near-{i}",
                "created_at": (now - timedelta(hours=6)).isoformat(),
                "location": f"POINT(78.50{i}0 17.40{i}0)",
                "description": "Similar yellowing in paddy",
            }
            for i in range(1, 5)
        ]
        all_incidents = [base_inc] + nearby_incidents

        priority, reasons = compute_incident_priority(base_inc, all_incidents=all_incidents)
        self.assertEqual(priority, "HIGH")
        self.assertIn("Multiple nearby complaints", reasons)
        self.assertIn("Recent reports", reasons)

    def test_high_priority_farmer_severity_and_recency(self):
        # Scenario: High severity reported by farmer + recent report (even if single isolated)
        now = datetime.now(timezone.utc)
        incident = {
            "id": "inc-urgent",
            "created_at": (now - timedelta(hours=2)).isoformat(),
            "location": "POINT(79.0000 18.0000)",
            "description": "Entire field dying, severe attack causing heavy crop damage",
            "ai_analysis": [
                {
                    "structured_data": {
                        "voice": {
                            "severity": "high",
                            "summary": "Severe foliar blight wiping out crop",
                        }
                    }
                }
            ],
        }

        priority, reasons = compute_incident_priority(incident, all_incidents=[incident])
        self.assertEqual(priority, "HIGH")
        self.assertIn("Recent reports", reasons)
        self.assertIn("High severity reported by farmer", reasons)

    def test_medium_priority_single_signal(self):
        # Scenario: Recent report without nearby complaints or urgent severity
        now = datetime.now(timezone.utc)
        incident = {
            "id": "inc-med",
            "created_at": (now - timedelta(hours=12)).isoformat(),
            "location": "POINT(77.0000 16.0000)",
            "description": "Some spots observed on 2 plants",
            "ai_analysis": [],
        }

        priority, reasons = compute_incident_priority(incident, all_incidents=[incident])
        self.assertEqual(priority, "MEDIUM")
        self.assertIn("Recent reports", reasons)

    def test_low_priority_isolated_older_report(self):
        # Scenario: Isolated report older than 7 days with normal severity
        now = datetime.now(timezone.utc)
        incident = {
            "id": "inc-low",
            "created_at": (now - timedelta(days=14)).isoformat(),
            "location": "POINT(77.0000 16.0000)",
            "description": "Normal minor leaf discoloration observed 2 weeks ago",
            "ai_analysis": [],
        }

        priority, reasons = compute_incident_priority(incident, all_incidents=[incident])
        self.assertEqual(priority, "LOW")
        self.assertIn("Single isolated complaint", reasons)

    def test_weak_yolo_does_not_inflate_priority(self):
        # Weak YOLO/image confidence must NOT by itself make an incident high priority
        now = datetime.now(timezone.utc)
        incident = {
            "id": "inc-yolo",
            "created_at": (now - timedelta(days=10)).isoformat(),
            "location": "POINT(77.0000 16.0000)",
            "description": "Leaf check",
            "ai_analysis": [
                {
                    "structured_data": {
                        "vision": {
                            "detections": [
                                {"class": "leaf_spot", "confidence": 0.22}
                            ]
                        }
                    }
                }
            ],
        }

        priority, reasons = compute_incident_priority(incident, all_incidents=[incident])
        self.assertNotEqual(priority, "HIGH")
        self.assertEqual(priority, "LOW")

    def test_cluster_priority_and_reasons(self):
        # Cluster of 6 incidents -> HIGH priority
        members_high = [{"id": f"inc-{i}", "priority": "LOW"} for i in range(6)]
        prio_high, reason_high = compute_cluster_priority(members_high)
        self.assertEqual(prio_high, "HIGH")
        self.assertIn("6 nearby complaints", reason_high)

        # Cluster of 3 incidents with high priority member -> HIGH priority
        members_mixed = [
            {"id": "inc-1", "priority": "HIGH"},
            {"id": "inc-2", "priority": "LOW"},
            {"id": "inc-3", "priority": "MEDIUM"},
        ]
        prio_mixed, reason_mixed = compute_cluster_priority(members_mixed)
        self.assertEqual(prio_mixed, "HIGH")

        # Cluster of 2 low incidents -> MEDIUM priority
        members_small = [{"id": "inc-1", "priority": "LOW"}, {"id": "inc-2", "priority": "LOW"}]
        prio_small, reason_small = compute_cluster_priority(members_small)
        self.assertEqual(prio_small, "MEDIUM")
        self.assertIn("2 localized complaints", reason_small)


if __name__ == "__main__":
    unittest.main()
