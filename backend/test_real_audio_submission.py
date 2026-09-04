import io
import requests

# Test real audio upload to /api/v1/incidents/upload
url = "http://localhost:8000/api/v1/incidents/upload"

# Create a mock webm/wav audio file
mock_audio_bytes = b"RIFF" + b"\x00" * 36 + b"WAVEfmt " + b"\x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data" + b"\x00" * 1000

files = {
    "audio": ("my_real_farmer_voice.wav", io.BytesIO(mock_audio_bytes), "audio/wav"),
}

data = {
    "farmer_name": "Srinivas Rao",
    "farmer_phone": "9848012345",
    "crop": "వరి",
    "description": "ఆకులపై ఎర్రటి మచ్చలు వస్తున్నాయి",
    "latitude": "17.457585",
    "longitude": "78.660425"
}

res = requests.post(url, data=data, files=files)
print("Status Code:", res.status_code)
print("Response JSON:", res.json())
