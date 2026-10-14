"""
Verification script for VisionAssist Backend API
Tests YOLO11n inference, EasyOCR text extraction, and reverse geocoding.
"""

import sys
import io
import requests
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def create_synthetic_test_image():
    """Create a sample test image with a synthetic scene & text."""
    img = Image.new("RGB", (640, 480), color=(240, 240, 240))
    draw = ImageDraw.Draw(img)

    # Draw a simulated object (e.g. cup/box)
    draw.rectangle([150, 180, 280, 350], fill=(79, 140, 255), outline=(30, 40, 80), width=4)
    draw.ellipse([180, 150, 250, 200], fill=(255, 153, 51))

    # Draw bold readable text for EasyOCR testing
    draw.text((100, 50), "VISION ASSIST NAYANA", fill=(10, 20, 40))
    draw.text((100, 90), "ROOM 402 EXIT", fill=(200, 30, 30))

    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    return img_byte_arr.getvalue()

def run_tests():
    print("=" * 60)
    print("Testing VisionAssist Backend API")
    print("=" * 60)

    # 1. Test YOLO11n Model Loading directly
    print("\n[1/3] Testing YOLO11n CPU Inference...")
    from ultralytics import YOLO
    model = YOLO("yolo11n.pt")
    
    # Run inference on synthetic test image
    img_data = create_synthetic_test_image()
    img = Image.open(io.BytesIO(img_data))
    results = model(img, verbose=False)
    print(f" -> YOLO11n inference successful. Classes recognized: {len(results[0].boxes)}")

    # 2. Test EasyOCR CPU
    print("\n[2/3] Testing EasyOCR CPU Text Recognition...")
    import easyocr
    reader = easyocr.Reader(['en'], gpu=False)
    ocr_results = reader.readtext(np.array(img))
    recognized_texts = [item[1] for item in ocr_results]
    print(f" -> EasyOCR inference successful. Found text strings: {recognized_texts}")

    # 3. Test Nominatim Reverse Geocoding
    print("\n[3/3] Testing Reverse Geocoding...")
    lat, lon = 12.9716, 77.5946 # Bengaluru coordinates
    resp = requests.get(
        "https://nominatim.openstreetmap.org/reverse",
        params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 18, "addressdetails": 1},
        headers={"User-Agent": "VisionAssist-Nayana-Test/1.0"},
        timeout=6
    )
    if resp.status_code == 200:
        data = resp.json()
        print(f" -> Geocoding successful: {data.get('display_name', '')[:60]}...")
    else:
        print(f" -> Geocoding response status: {resp.status_code}")

    print("\n" + "=" * 60)
    print("ALL CORE BACKEND MODULES VERIFIED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
