import struct
from app.database.session import get_supabase_client

client = get_supabase_client()
res = client.table("incidents").select("id, crop, description, location, location_source, created_at").order("created_at", desc=True).limit(6).execute()

def decode_ewkb_point(hex_str):
    if not hex_str or len(hex_str) < 42:
        return None
    try:
        raw_bytes = bytes.fromhex(hex_str)
        endian = '<' if raw_bytes[0] == 1 else '>'
        # EWKB with SRID (0x20 flag): byte 0 (endian), bytes 1-4 (geom type), bytes 5-8 (SRID), bytes 9-16 (X=lng), bytes 17-24 (Y=lat)
        lng, lat = struct.unpack(f"{endian}dd", raw_bytes[9:25])
        return lat, lng
    except Exception as e:
        return None

for r in res.data:
    loc_val = r.get("location")
    decoded = decode_ewkb_point(loc_val) if isinstance(loc_val, str) else None
    print(f"ID: {r['id'][:8]} | Decoded Lat/Lng: {decoded} | Source: {r.get('location_source')}")
