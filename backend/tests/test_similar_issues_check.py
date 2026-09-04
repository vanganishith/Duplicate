import unittest
import asyncio
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.similar_issues_service import (
    find_similar_issues,
    confirm_similar_issues,
    get_incident_similar_confirmations,
    _format_location_label,
    _determine_verification_status,
)
from app.services.llm_service import _deterministic_symptom_similarity_fallback

client = TestClient(app)

class TestSimilarIssuesCheck(unittest.TestCase):

    def setUp(self):
        self.sample_tomato_incident_id = "392f281c-1caa-41e9-93d7-f7d712881938"

    def test_format_location_label_anonymization(self):
        """Verify exact coordinates/addresses are NEVER exposed in location labels."""
        loc_te = _format_location_label(2.1, language="Telugu")
        self.assertNotIn(".", loc_te)  # No coordinate values
        self.assertNotIn("GPS", loc_te)
        self.assertIn("సమీపంలో", loc_te)

        loc_en = _format_location_label(7.4, language="English")
        self.assertIn("About 7 km away", loc_en)

    def test_verification_status_identification(self):
        """Verify resolved and advisory-endorsed incidents are identified as AEO_VERIFIED."""
        resolved_inc = {"status": "RESOLVED"}
        status = _determine_verification_status(resolved_inc, [])
        self.assertEqual(status, "AEO_VERIFIED")

        ai_inc = {"status": "AI_ANALYZED"}
        status_ai = _determine_verification_status(ai_inc, [])
        self.assertEqual(status_ai, "AI_PRELIMINARY")

        adv_inc = {"status": "INVESTIGATING"}
        ai_records = [{"structured_data": {"advisory": {"text": "Field verified"}}}]
        status_adv = _determine_verification_status(adv_inc, ai_records)
        self.assertEqual(status_adv, "AEO_VERIFIED")

    def test_deterministic_symptom_matching_separates_unrelated_crop_issues(self):
        """
        Verify that a tomato leaf spot complaint matches previous tomato leaf lesions,
        but DOES NOT match tomato price complaints, tomato irrigation, or unrelated crops.
        """
        current_case = {
            "crop": "Tomato",
            "problem": "round brown spots on leaves spreading for 5 days",
            "symptoms": ["brown spots", "drying leaves"]
        }

        candidates = [
            {
                "id": "cand-1-leaf-spots",
                "crop": "Tomato",
                "problem": "brown necrotic lesions on lower tomato foliage and drying",
                "symptoms": ["brown lesions", "drying"]
            },
            {
                "id": "cand-2-price",
                "crop": "Tomato",
                "problem": "market mandi price dropped to 5 rupees per kilo, need subsidy",
                "symptoms": []
            },
            {
                "id": "cand-3-unrelated-crop",
                "crop": "Cotton",
                "problem": "bollworm damage in cotton bolls",
                "symptoms": ["bollworm"]
            },
            {
                "id": "cand-4-cracking",
                "crop": "Tomato",
                "problem": "heavy rain caused tomato fruit skin cracking and splitting",
                "symptoms": ["cracking", "splitting"]
            }
        ]

        results = _deterministic_symptom_similarity_fallback(current_case, candidates, language="English")
        by_id = {r["candidate_id"]: r for r in results}

        # 1. Leaf spot candidate MUST be genuinely similar with high score
        self.assertTrue(by_id["cand-1-leaf-spots"]["is_genuinely_similar"])
        self.assertGreaterEqual(by_id["cand-1-leaf-spots"]["similarity_score"], 0.65)
        self.assertIsNotNone(by_id["cand-1-leaf-spots"]["why_similar"])

        # 2. Tomato price complaint MUST NOT be similar
        self.assertFalse(by_id["cand-2-price"]["is_genuinely_similar"])
        self.assertLess(by_id["cand-2-price"]["similarity_score"], 0.4)

        # 3. Cotton bollworm MUST NOT be similar
        self.assertFalse(by_id["cand-3-unrelated-crop"]["is_genuinely_similar"])

        # 4. Tomato fruit cracking has different symptoms from leaf spots
        self.assertFalse(by_id["cand-4-cracking"]["is_genuinely_similar"])

    def test_find_similar_issues_live_database_or_mock(self):
        """
        Tests find_similar_issues on real tomato incident 392f281c-1caa-41e9-93d7-f7d712881938.
        Verifies max 4 results, privacy, and required schema.
        """
        async def run_find():
            return await find_similar_issues(self.sample_tomato_incident_id, max_results=4, language="Telugu")

        res = asyncio.run(run_find())
        self.assertTrue(res.get("success"))
        similar = res.get("similar_issues", [])

        # Must return at most 4 results
        self.assertLessEqual(len(similar), 4)

        for issue in similar:
            # Schema assertions
            self.assertIn("incident_id", issue)
            self.assertIn("crop", issue)
            self.assertIn("problem", issue)
            self.assertIn("location_label", issue)
            self.assertIn("verification_status", issue)
            self.assertIn("outcome", issue)
            self.assertIn("why_similar", issue)

            # Strict Privacy assertions: No farmer name, phone number, exact coordinates, or exact address
            self.assertNotIn("farmer_name", issue)
            self.assertNotIn("phone", issue)
            self.assertNotIn("latitude", issue)
            self.assertNotIn("longitude", issue)

    def test_confirm_similar_issue_does_not_create_duplicate_incident(self):
        """
        Verifies that confirming a similar issue records confirmation on the SAME incident
        without creating a new incident or duplicating the complaint.
        """
        target_id = self.sample_tomato_incident_id
        matched_ids = ["16dd7774-fb25-4c42-b3db-069c152172e1"]

        res = confirm_similar_issues(
            current_incident_id=target_id,
            matched_incident_ids=matched_ids,
            farmer_phone="9876543210",
            farmer_name="Test Farmer",
        )

        self.assertTrue(res.get("success"))
        self.assertEqual(res.get("incident_id"), target_id)
        self.assertIn("confirmations", res)

        # Verify confirmation can be fetched from incident
        confs = get_incident_similar_confirmations(target_id)
        self.assertTrue(any(c.get("matched_incident_id") == matched_ids[0] for c in confs))

    def test_api_endpoint_get_similar_issues(self):
        """Test GET /api/v1/incidents/{incident_id}/similar-issues endpoint."""
        response = client.get(f"/api/v1/incidents/{self.sample_tomato_incident_id}/similar-issues?language=Telugu")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertIsInstance(data.get("similar_issues"), list)
        self.assertLessEqual(len(data.get("similar_issues")), 4)

    def test_api_endpoint_confirm_similar(self):
        """Test POST /api/v1/incidents/{incident_id}/confirm-similar endpoint."""
        payload = {
            "matched_incident_ids": ["16dd7774-fb25-4c42-b3db-069c152172e1"],
            "farmer_phone": "9876543210"
        }
        response = client.post(f"/api/v1/incidents/{self.sample_tomato_incident_id}/confirm-similar", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("incident_id"), self.sample_tomato_incident_id)

    def test_api_get_incident_detail_includes_similar_confirmations(self):
        """Verify GET /api/v1/incidents/{id} includes similar_issue_confirmations for AEO."""
        response = client.get(f"/api/v1/incidents/{self.sample_tomato_incident_id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertIn("similar_issue_confirmations", data)
        self.assertIn("similar_issue_confirmations", data.get("incident", {}))

    def test_search_failure_tolerance(self):
        """Verify API handles non-existent incident or search error gracefully without blocking."""
        response = client.get("/api/v1/incidents/00000000-0000-0000-0000-000000000000/similar-issues")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("similar_issues"), [])


if __name__ == "__main__":
    unittest.main()
