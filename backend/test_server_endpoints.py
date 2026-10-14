"""
Comprehensive FastAPI endpoint testing using Starlette/FastAPI TestClient.
Tests /api/health, /api/detect, /api/ocr, /api/geocode, and static file serving.
"""

import io
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from main import app

def generate_test_image_bytes():
    img = Image.new("RGB", (640, 480), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([100, 100, 300, 300], fill=(50, 100, 200))
    draw.text((120, 150), "STOP SIGN AHEAD", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

def run_endpoint_tests():
    client = TestClient(app)

    print("\n--- 1. Testing GET /api/health ---")
    resp = client.get("/api/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    print("Health response:", resp.json())

    print("\n--- 2. Testing POST /api/detect ---")
    img_bytes = generate_test_image_bytes()
    resp = client.post(
        "/api/detect",
        files={"file": ("test.jpg", img_bytes, "image/jpeg")},
        data={"conf_threshold": 0.25}
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    detect_data = resp.json()
    print("Detect success:", detect_data["success"])
    print("Count:", detect_data["count"])
    print("Narrative:", detect_data["narrative"])

    print("\n--- 3. Testing POST /api/ocr ---")
    resp = client.post(
        "/api/ocr",
        files={"file": ("ocr.jpg", img_bytes, "image/jpeg")}
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    ocr_data = resp.json()
    print("OCR success:", ocr_data["success"])
    print("Extracted text:", ocr_data["text"])
    print("OCR narrative:", ocr_data["narrative"])

    print("\n--- 4. Testing POST /api/geocode ---")
    resp = client.post(
        "/api/geocode",
        json={"latitude": 28.6139, "longitude": 77.2090} # New Delhi
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    geo_data = resp.json()
    print("Geocode success:", geo_data["success"])
    print("Spoken address narrative:", geo_data["narrative"])
    print("Google Maps link:", geo_data["maps_url"])

    print("\n--- 5. Testing GET / (Frontend delivery) ---")
    resp = client.get("/")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    assert "VisionAssist" in resp.text, "VisionAssist not found in HTML response"
    print("Root index.html served successfully, size:", len(resp.text), "bytes")

    print("\n========================================================")
    print("ALL 5 ENDPOINTS PASSED VERIFICATION WITH 100% SUCCESS!")
    print("========================================================")

if __name__ == "__main__":
    run_endpoint_tests()
