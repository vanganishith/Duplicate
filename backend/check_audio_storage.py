from app.database.session import get_supabase_client

client = get_supabase_client()
try:
    buckets = client.storage.list_buckets()
    print("Buckets in Supabase:", [b.name for b in buckets])
except Exception as e:
    print("Error listing buckets:", e)

res = client.table("incidents").select("id, farmer_id, description, audio_url, photo_url, created_at").order("created_at", desc=True).limit(5).execute()
for r in res.data:
    print(f"Incident: {r['id'][:8]} | Audio URL: {r.get('audio_url')} | Photo URL: {bool(r.get('photo_url'))}")
