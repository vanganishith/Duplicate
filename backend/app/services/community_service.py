import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.phone import normalize_phone
from app.database.session import get_supabase_client
from app.services.incident_service import get_incident_by_id, upload_incident_photo, format_incident_location, get_incident_timeline
from app.services.advisory_service import get_incident_advisory

MAX_POST_LENGTH = 2000
MAX_COMMENT_LENGTH = 1000


def _client():
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Database connection not configured")
    return client


def _resolve_farmer(client, farmer_id: Optional[str] = None, farmer_phone: Optional[str] = None) -> Dict[str, Any]:
    if farmer_id:
        response = client.table("farmers").select("id, name, phone, village, district, state, location").eq("id", farmer_id).limit(1).execute()
    elif farmer_phone:
        response = client.table("farmers").select("id, name, phone, village, district, state, location").eq("phone", normalize_phone(farmer_phone)).limit(1).execute()
    else:
        raise ValueError("A farmer profile is required.")
    if not response.data:
        raise ValueError("Farmer profile not found. Submit an incident first to create your profile.")
    return response.data[0]


def _public_farmer(farmer: Dict[str, Any], helpful_count: int = 0) -> Dict[str, Any]:
    return {
        "id": str(farmer.get("id")),
        "name": farmer.get("name") or "Farmer",
        "helpful_count": helpful_count,
        "crop": farmer.get("crop"),
    }


def _profile_helpful_counts(client, farmer_ids: List[str]) -> Dict[str, int]:
    if not farmer_ids:
        return {}
    rows = client.table("community_comments").select("farmer_id, id").in_("farmer_id", farmer_ids).execute().data or []
    comment_ids = [str(row["id"]) for row in rows]
    counts = {farmer_id: 0 for farmer_id in farmer_ids}
    if not comment_ids:
        return counts
    reactions = client.table("community_comment_reactions").select("comment_id").in_("comment_id", comment_ids).execute().data or []
    comment_owner = {str(row["id"]): str(row["farmer_id"]) for row in rows}
    for reaction in reactions:
        owner = comment_owner.get(str(reaction.get("comment_id")))
        if owner:
            counts[owner] = counts.get(owner, 0) + 1
    return counts


def _decorate_comments(client, comments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    farmer_ids = [str(comment.get("farmer_id")) for comment in comments if comment.get("farmer_id")]
    farmers = client.table("farmers").select("id, name").in_("id", farmer_ids).execute().data or [] if farmer_ids else []
    farmer_map = {str(farmer["id"]): farmer for farmer in farmers}
    comment_ids = [str(comment["id"]) for comment in comments]
    reactions = client.table("community_comment_reactions").select("comment_id").in_("comment_id", comment_ids).execute().data or [] if comment_ids else []
    reaction_counts: Dict[str, int] = {}
    for reaction in reactions:
        key = str(reaction.get("comment_id"))
        reaction_counts[key] = reaction_counts.get(key, 0) + 1
    helpful_counts = _profile_helpful_counts(client, farmer_ids)
    decorated = []
    for comment in comments:
        farmer = farmer_map.get(str(comment.get("farmer_id")), {})
        officer = None
        if comment.get("officer_id"):
            officer_rows = client.table("officers").select("id, name, role").eq("id", comment["officer_id"]).limit(1).execute().data or []
            officer = officer_rows[0] if officer_rows else None
        decorated.append({
            "id": str(comment["id"]),
            "content": comment.get("content"),
            "created_at": comment.get("created_at"),
            "helpful_count": reaction_counts.get(str(comment["id"]), 0),
            "author": _public_farmer(farmer, helpful_counts.get(str(comment.get("farmer_id")), 0)),
            "is_officer": bool(officer),
            "officer": {"id": str(officer["id"]), "name": officer.get("name"), "role": officer.get("role")} if officer else None,
        })
    return decorated


def _decorate_posts(client, posts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not posts:
        return []
    farmer_ids = [str(post.get("farmer_id")) for post in posts if post.get("farmer_id")]
    farmers = client.table("farmers").select("id, name").in_("id", farmer_ids).execute().data or [] if farmer_ids else []
    farmer_map = {str(farmer["id"]): farmer for farmer in farmers}
    post_ids = [str(post["id"]) for post in posts]
    comments = client.table("community_comments").select("id, post_id, farmer_id, content, officer_id, created_at").in_("post_id", post_ids).order("created_at").execute().data or []
    reactions = client.table("community_comment_reactions").select("comment_id").in_("comment_id", [str(c["id"]) for c in comments]).execute().data or [] if comments else []
    reaction_counts: Dict[str, int] = {}
    for reaction in reactions:
        key = str(reaction.get("comment_id"))
        reaction_counts[key] = reaction_counts.get(key, 0) + 1
    author_ids = [str(post.get("farmer_id")) for post in posts if post.get("farmer_id")]
    author_helpful = _profile_helpful_counts(client, author_ids)
    decorated = []
    for post in posts:
        author = farmer_map.get(str(post.get("farmer_id")), {})
        post_comments = [comment for comment in comments if str(comment.get("post_id")) == str(post["id"])]
        decorated.append({
            "id": str(post["id"]),
            "content": post.get("content"),
            "photo_url": post.get("photo_url"),
            "created_at": post.get("created_at"),
            "updated_at": post.get("updated_at"),
            "crop": post.get("crop"),
            "incident_id": str(post["incident_id"]) if post.get("incident_id") else None,
            "related_problem": bool(post.get("incident_id")),
            "helpful_count": author_helpful.get(str(post.get("farmer_id")), 0),
            "comment_count": len(post_comments),
            "author": _public_farmer(author),
            "comments": _decorate_comments(client, post_comments),
        })
    return decorated


def list_posts(limit: int = 30) -> Dict[str, Any]:
    client = _client()
    posts = client.table("community_posts").select("id, farmer_id, incident_id, content, photo_url, created_at, updated_at, crop").order("created_at", desc=True).limit(min(limit, 50)).execute().data or []
    return {"success": True, "posts": _decorate_posts(client, posts)}


def list_farmer_incidents(farmer_id: Optional[str] = None, farmer_phone: Optional[str] = None, limit: int = 30) -> Dict[str, Any]:
    client = _client()
    farmer = _resolve_farmer(client, farmer_id, farmer_phone)
    incidents = client.table("incidents").select("id, crop, description, photo_url, photos, status, priority, location, created_at, updated_at").eq("farmer_id", farmer["id"]).order("created_at", desc=True).limit(min(limit, 50)).execute().data or []
    profile = _public_farmer(farmer)
    for incident in incidents:
        location = format_incident_location(dict(incident))
        if location.get("latitude") is not None and location.get("longitude") is not None:
            profile["latitude"] = location["latitude"]
            profile["longitude"] = location["longitude"]
            break
    if profile.get("latitude") is None and farmer.get("location"):
        location = format_incident_location({"location": farmer["location"]})
        if location.get("latitude") is not None and location.get("longitude") is not None:
            profile["latitude"] = location["latitude"]
            profile["longitude"] = location["longitude"]
    for incident in incidents:
        incident.pop("location", None)
    return {"success": True, "farmer": profile, "incidents": incidents}


def get_post(post_id: str) -> Dict[str, Any]:
    client = _client()
    rows = client.table("community_posts").select("id, farmer_id, incident_id, content, photo_url, created_at, updated_at, crop").eq("id", post_id).limit(1).execute().data or []
    if not rows:
        raise ValueError("Community post not found.")
    return {"success": True, "post": _decorate_posts(client, rows)[0]}


def create_post(farmer_id: Optional[str], farmer_phone: Optional[str], content: str, crop: Optional[str], incident_id: Optional[str], photo_url: Optional[str]) -> Dict[str, Any]:
    client = _client()
    farmer = _resolve_farmer(client, farmer_id, farmer_phone)
    clean_content = (content or "").strip()
    if not clean_content:
        raise ValueError("Post content cannot be empty.")
    if len(clean_content) > MAX_POST_LENGTH:
        raise ValueError(f"Post content must be {MAX_POST_LENGTH} characters or fewer.")
    if incident_id and not get_incident_by_id(incident_id):
        raise ValueError("Related incident was not found.")
    payload = {"farmer_id": farmer["id"], "content": clean_content, "crop": (crop or "").strip() or None, "incident_id": incident_id or None, "photo_url": photo_url or None}
    row = client.table("community_posts").insert(payload).execute().data[0]
    return {"success": True, "post": _decorate_posts(client, [row])[0]}


def create_comment(post_id: str, farmer_id: Optional[str], farmer_phone: Optional[str], content: str, officer_id: Optional[str] = None) -> Dict[str, Any]:
    client = _client()
    farmer = _resolve_farmer(client, farmer_id, farmer_phone)
    clean_content = (content or "").strip()
    if not clean_content:
        raise ValueError("Comment content cannot be empty.")
    if len(clean_content) > MAX_COMMENT_LENGTH:
        raise ValueError(f"Comment must be {MAX_COMMENT_LENGTH} characters or fewer.")
    if officer_id:
        raise ValueError("Farmer comments cannot identify themselves as an officer.")
    post_exists = client.table("community_posts").select("id").eq("id", post_id).limit(1).execute().data
    if not post_exists:
        raise ValueError("Community post not found.")
    row = client.table("community_comments").insert({"post_id": post_id, "farmer_id": farmer["id"], "content": clean_content}).execute().data[0]
    return {"success": True, "comment": _decorate_comments(client, [row])[0]}


def create_problem_comment(problem_id: str, farmer_id: Optional[str], farmer_phone: Optional[str], content: str) -> Dict[str, Any]:
    client = _client()
    incident = get_incident_by_id(problem_id)
    if not incident:
        raise ValueError("Agricultural problem not found.")
    posts = client.table("community_posts").select("id").eq("incident_id", problem_id).order("created_at").limit(1).execute().data or []
    if posts:
        post_id = posts[0]["id"]
    else:
        post = client.table("community_posts").insert({
            "farmer_id": incident["farmer_id"],
            "incident_id": problem_id,
            "content": "Discussion about this reported agricultural problem.",
            "crop": incident.get("crop"),
        }).execute().data[0]
        post_id = post["id"]
    return create_comment(post_id, farmer_id, farmer_phone, content)


def add_helpful_reaction(comment_id: str, farmer_id: Optional[str], farmer_phone: Optional[str]) -> Dict[str, Any]:
    client = _client()
    farmer = _resolve_farmer(client, farmer_id, farmer_phone)
    comment = client.table("community_comments").select("id").eq("id", comment_id).limit(1).execute().data
    if not comment:
        raise ValueError("Community comment not found.")
    try:
        client.table("community_comment_reactions").insert({"comment_id": comment_id, "farmer_id": farmer["id"], "reaction": "HELPFUL"}).execute()
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ValueError("You already marked this comment Helpful.")
        raise
    return {"success": True, "message": "Marked Helpful."}


def get_problem(problem_id: str) -> Dict[str, Any]:
    client = _client()
    incident = get_incident_by_id(problem_id)
    if not incident:
        raise ValueError("Agricultural problem not found.")
    farmer = incident.get("farmers") or {}
    advisory = get_incident_advisory(problem_id)
    timeline = get_incident_timeline(problem_id, incident)
    posts = client.table("community_posts").select("id, farmer_id, incident_id, content, photo_url, created_at, updated_at, crop").eq("incident_id", problem_id).order("created_at", desc=True).limit(30).execute().data or []
    confirmations = client.table("community_confirmations").select("id, response").eq("incident_id", problem_id).execute().data or []
    photo_url = incident.get("photo_url")
    if not photo_url and isinstance(incident.get("photos"), list) and incident["photos"]:
        photo_url = incident["photos"][0]
    return {"success": True, "problem": {
        "id": str(incident["id"]),
        "crop": incident.get("crop") or "Crop",
        "description": incident.get("description"),
        "photo_url": photo_url,
        "created_at": incident.get("created_at"),
        "status": incident.get("status") or "NEW",
        "priority": incident.get("priority") or "LOW",
        "timeline": timeline,
        "locality": "Near your locality",
        "farmer_name": farmer.get("name") or "Farmer",
        "community_confirmations_count": sum(1 for row in confirmations if row.get("response") == "YES"),
        "advisory": advisory,
        "posts": _decorate_posts(client, posts),
    }}


def upload_community_photo(file_bytes: bytes, filename: str, content_type: str) -> str:
    return upload_incident_photo(file_bytes, filename, content_type)
