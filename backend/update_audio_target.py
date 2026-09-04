from app.database.session import get_supabase_client

client = get_supabase_client()
public_audio_url = "http://localhost:8000/uploads/audio/farmer_voice_sample_telugu.wav"
client.table("incidents").update({"audio_url": public_audio_url}).eq("id", "6bbb384b-c83b-4d51-894b-1de998c21688").execute()
print("Updated incident 6bbb384b with audio_url successfully!")
