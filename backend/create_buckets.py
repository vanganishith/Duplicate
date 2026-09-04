from app.database.session import get_supabase_client

client = get_supabase_client()
for b_name in ["incident-audio", "incident-photos"]:
    try:
        res = client.storage.create_bucket(b_name, options={"public": True})
        print(f"Created bucket '{b_name}':", res)
    except Exception as e:
        print(f"Bucket '{b_name}' status:", e)

try:
    buckets = client.storage.list_buckets()
    print("Available buckets now:", [b.name for b in buckets])
except Exception as e:
    print("List buckets error:", e)
