from typing import Optional
from supabase import create_client, Client
from app.core.config import settings

_supabase_client: Optional[Client] = None


def get_supabase_client() -> Optional[Client]:
    """
    Returns an initialized Supabase client instance.
    Returns None if SUPABASE_URL or SUPABASE_KEY are not configured.
    """
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        return _supabase_client
    
    return None


def check_db_connection() -> dict:
    """
    Checks if Supabase client is configured and can query the database.
    """
    client = get_supabase_client()
    if client is None:
        return {"configured": False, "connected": False, "message": "Supabase credentials not configured in environment"}
    
    try:
        # Simple health probe on farmers table
        response = client.table("farmers").select("id", count="exact").limit(1).execute()
        return {"configured": True, "connected": True, "message": "Successfully connected to Supabase"}
    except Exception as e:
        return {"configured": True, "connected": False, "error": str(e)}

