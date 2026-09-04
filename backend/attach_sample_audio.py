import os
import wave
import math
import struct
from app.database.session import get_supabase_client
from app.services.incident_service import AUDIO_UPLOADS_DIR

# Create a clear sample wav audio recording for testing if needed
sample_audio_filename = "farmer_voice_sample_telugu.wav"
sample_audio_path = os.path.join(AUDIO_UPLOADS_DIR, sample_audio_filename)

if not os.path.exists(sample_audio_path):
    with wave.open(sample_audio_path, "w") as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2) # 16-bit
        wav_file.setframerate(16000) # 16kHz
        # Generate 3 seconds of voice-frequency tones
        for i in range(16000 * 3):
            value = int(32767.0 * 0.3 * math.sin(2.0 * math.pi * 440.0 * i / 16000))
            data = struct.pack('<h', value)
            wav_file.writeframesraw(data)

public_audio_url = f"http://localhost:8000/uploads/audio/{sample_audio_filename}"

client = get_supabase_client()
# Update recent incidents that have missing audio_url
res = client.table("incidents").select("id, audio_url").is_("audio_url", "null").limit(5).execute()
for r in res.data:
    client.table("incidents").update({"audio_url": public_audio_url}).eq("id", r["id"]).execute()
    print(f"Updated incident {r['id'][:8]} with audio_url: {public_audio_url}")
