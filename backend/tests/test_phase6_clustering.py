import unittest
from unittest.mock import patch, MagicMock
from app.services.incident_service import (
    haversine_distance_km,
    decode_postgis_point,
    format_incident_location,
    get_map_incidents_and_clusters,
)
from fastapi.testclient import TestClient
from app.main import app


class TestPhase6Clustering(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_haversine_distance_calculation(self):
        # Distance between Warangal (17.9689, 79.5941) and Geesugonda (17.9358, 79.7020) ~ 12 km
        dist = haversine_distance_km(17.9689, 79.5941, 17.9358, 79.7020)
        self.assertGreater(dist, 10.0)
        self.assertLess(dist, 15.0)

        # Same point distance is 0
        dist_zero = haversine_distance_km(17.9689, 79.5941, 17.9689, 79.5941)
        self.assertAlmostEqual(dist_zero, 0.0, places=5)

    def test_decode_postgis_point(self):
        # 1. GeoJSON dictionary
        geojson = {"type": "Point", "coordinates": [79.6755, 17.9692]}
        lat_lng = decode_postgis_point(geojson)
        self.assertIsNotNone(lat_lng)
        self.assertAlmostEqual(lat_lng[0], 17.9692, places=4)
        self.assertAlmostEqual(lat_lng[1], 79.6755, places=4)

        # 2. WKT string
        wkt = "POINT(79.6755 17.9692)"
        lat_lng_wkt = decode_postgis_point(wkt)
        self.assertIsNotNone(lat_lng_wkt)
        self.assertAlmostEqual(lat_lng_wkt[0], 17.9692, places=4)
        self.assertAlmostEqual(lat_lng_wkt[1], 79.6755, places=4)

        # 3. None or invalid
        self.assertIsNone(decode_postgis_point(None))
        self.assertIsNone(decode_postgis_point("INVALID"))

    def test_format_incident_location(self):
        inc = {
            "id": "test-123",
            "location": "POINT(79.6755 17.9692)",
        }
        formatted = format_incident_location(inc)
        self.assertEqual(formatted["latitude"], 17.9692)
        self.assertEqual(formatted["longitude"], 79.6755)
        self.assertEqual(formatted["location"]["type"], "Point")

    @patch("app.services.incident_service.get_supabase_client")
    def test_get_map_incidents_and_clusters_logic(self, mock_get_client):
        # Mock database with 3 nearby chilli incidents and 1 distant cotton incident
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        mock_data = [
            {
                "id": "inc-1",
                "crop": "Chilli",
                "description": "Chilli leaves are curling and yellow",
                "status": "NEW",
                "priority": "HIGH",
                "location": "POINT(79.6750 17.9680)",
                "created_at": "2026-09-02T10:00:00Z",
                "farmers": {"name": "Ramesh", "village": "Geesugonda", "district": "Warangal"},
                "ai_analysis": [],
            },
            {
                "id": "inc-2",
                "crop": "Chilli",
                "description": "Chilli plant curling upward",
                "status": "NEW",
                "priority": "HIGH",
                "location": "POINT(79.6755 17.9685)",
                "created_at": "2026-09-02T11:00:00Z",
                "farmers": {"name": "Suresh", "village": "Geesugonda", "district": "Warangal"},
                "ai_analysis": [],
            },
            {
                "id": "inc-3",
                "crop": "Chilli",
                "description": "Chilli leaf yellowing and curl",
                "status": "ACKNOWLEDGED",
                "priority": "MEDIUM",
                "location": "POINT(79.6760 17.9690)",
                "created_at": "2026-09-02T12:00:00Z",
                "farmers": {"name": "Anil", "village": "Geesugonda", "district": "Warangal"},
                "ai_analysis": [],
            },
            {
                "id": "inc-4",
                "crop": "Cotton",
                "description": "Cotton bollworm infestation",
                "status": "NEW",
                "priority": "LOW",
                "location": "POINT(79.1670 18.5840)",  # ~100 km away in Karimnagar
                "created_at": "2026-09-02T08:00:00Z",
                "farmers": {"name": "Laxmi", "village": "Choppadandi", "district": "Karimnagar"},
                "ai_analysis": [],
            },
        ]

        mock_query = MagicMock()
        mock_query.execute.return_value = MagicMock(data=mock_data)
        mock_client.table.return_value.select.return_value.order.return_value = mock_query

        res = get_map_incidents_and_clusters()

        self.assertTrue(res["success"])
        self.assertEqual(len(res["incidents"]), 4)
        self.assertEqual(res["summary"]["total"], 4)
        self.assertEqual(res["summary"]["new"], 3)
        self.assertEqual(res["summary"]["in_progress"], 1)

        # 1 cluster formed by the 3 nearby Chilli incidents
        self.assertEqual(len(res["clusters"]), 1)
        cluster = res["clusters"][0]
        self.assertEqual(cluster["incident_count"], 3)
        self.assertEqual(cluster["crop"], "Chilli")
        self.assertEqual(cluster["area"], "Geesugonda, Warangal")
        self.assertIn("inc-1", cluster["incident_ids"])
        self.assertIn("inc-2", cluster["incident_ids"])
        self.assertIn("inc-3", cluster["incident_ids"])
        self.assertNotIn("inc-4", cluster["incident_ids"])
        self.assertIn("Similar reports", cluster["common_issue"])

    def test_map_endpoint_integration(self):
        # Test GET /api/v1/incidents/map
        response = self.client.get("/api/v1/incidents/map")
        self.assertEqual(response.status_code, 200)
        json_data = response.json()
        self.assertTrue(json_data["success"])
        self.assertIn("incidents", json_data)
        self.assertIn("clusters", json_data)
        self.assertIn("summary", json_data)
        self.assertIn("total", json_data["summary"])

    def test_clusters_endpoint_integration(self):
        # Test GET /api/v1/clusters
        response = self.client.get("/api/v1/clusters")
        self.assertEqual(response.status_code, 200)
        json_data = response.json()
        self.assertTrue(json_data["success"])
        self.assertIn("clusters", json_data)


if __name__ == "__main__":
    unittest.main()
