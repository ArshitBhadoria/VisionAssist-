"""
VisionAssist – Nayana Vision Assist
Backend API Server (FastAPI + YOLO11n + EasyOCR + Geocoding)
"""

import os
import io
import time
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path

import requests
import numpy as np
from PIL import Image

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("VisionAssist")

app = FastAPI(
    title="VisionAssist – Nayana API",
    description="AI-powered accessibility backend with YOLO11n object detection and EasyOCR",
    version="1.0.0"
)

# Enable CORS for frontend flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model holders
yolo_model = None
ocr_reader = None
models_loading = False

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"


def get_yolo_model():
    """Lazy load YOLO11n on CPU."""
    global yolo_model
    if yolo_model is None:
        logger.info("Loading YOLO11n model (yolo11n.pt) on CPU...")
        from ultralytics import YOLO
        # yolo11n is ultra-fast, lightweight (~5.4 MB)
        yolo_model = YOLO("yolo11n.pt")
        logger.info("YOLO11n model loaded successfully.")
    return yolo_model


def get_ocr_reader():
    """Lazy load EasyOCR reader on CPU."""
    global ocr_reader
    if ocr_reader is None:
        logger.info("Loading EasyOCR reader on CPU (en)...")
        import easyocr
        ocr_reader = easyocr.Reader(["en"], gpu=False)
        logger.info("EasyOCR reader initialized.")
    return ocr_reader


def describe_spatial_layout(detections: List[Dict[str, Any]], img_w: int, img_h: int) -> str:
    """Generate a coherent, natural English spoken scene description for visually impaired users."""
    if not detections:
        return "I do not detect any distinct objects in front of you. Try slowly panning your camera or improving the room lighting."

    # Group items by relative position
    left_items = []
    center_items = []
    right_items = []

    for d in detections:
        box = d["box"]
        label = d["label"]
        conf = int(d["confidence"])
        cx = (box[0] + box[2]) / 2.0
        area_ratio = ((box[2] - box[0]) * (box[3] - box[1])) / float(img_w * img_h)

        proximity = "close" if area_ratio > 0.18 else ("nearby" if area_ratio > 0.06 else "at a distance")
        item_desc = f"{label} ({proximity}, {conf}%)"

        if cx < img_w * 0.35:
            left_items.append(item_desc)
        elif cx > img_w * 0.65:
            right_items.append(item_desc)
        else:
            center_items.append(item_desc)

    parts = []
    total = len(detections)
    parts.append(f"I see {total} object{'s' if total > 1 else ''}.")

    if center_items:
        parts.append(f"Directly in front of you: {', '.join(center_items)}.")
    if left_items:
        parts.append(f"On your left: {', '.join(left_items)}.")
    if right_items:
        parts.append(f"On your right: {', '.join(right_items)}.")

    return " ".join(parts)


@app.get("/api/health")
async def health_check():
    """Health check endpoint to test connection and model readiness."""
    return {
        "status": "healthy",
        "service": "VisionAssist – Nayana Backend",
        "yolo_ready": yolo_model is not None,
        "ocr_ready": ocr_reader is not None,
        "timestamp": time.time()
    }


@app.post("/api/detect")
async def detect_objects(file: UploadFile = File(...), conf_threshold: float = Form(0.30)):
    """
    Perform real-time object detection using YOLO11n.
    Returns detected objects, bounding boxes, confidence ratings, and spoken narrative.
    """
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        img_w, img_h = image.size

        # Run YOLO11n
        model = get_yolo_model()
        results = model(image, conf=conf_threshold, verbose=False)

        detections = []
        if results and len(results) > 0:
            r = results[0]
            boxes = r.boxes
            if boxes is not None:
                for box in boxes:
                    xyxy = box.xyxy[0].tolist()
                    cls_id = int(box.cls[0].item())
                    conf = float(box.conf[0].item()) * 100.0
                    label = model.names.get(cls_id, f"item {cls_id}")

                    # Determine position
                    cx = (xyxy[0] + xyxy[2]) / 2.0
                    pos = "left" if cx < img_w * 0.35 else ("right" if cx > img_w * 0.65 else "center")

                    detections.append({
                        "label": label,
                        "confidence": round(conf, 1),
                        "box": [round(coord, 1) for coord in xyxy],
                        "position": pos
                    })

        # Sort detections by confidence descending
        detections.sort(key=lambda x: x["confidence"], reverse=True)

        # Generate spatial narrative for speech synthesis
        narrative = describe_spatial_layout(detections, img_w, img_h)

        return {
            "success": True,
            "count": len(detections),
            "detections": detections,
            "narrative": narrative,
            "image_size": {"width": img_w, "height": img_h}
        }

    except Exception as e:
        logger.error(f"Error during object detection: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")


@app.post("/api/ocr")
async def read_text(file: UploadFile = File(...)):
    """
    Perform optical character recognition using EasyOCR.
    Returns recognized text chunks, confidence, coordinates, and spoken output.
    """
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        img_np = np.array(image)

        reader = get_ocr_reader()
        # Returns list of (bbox, text, prob)
        raw_results = reader.readtext(img_np)

        blocks = []
        full_text_chunks = []

        for item in raw_results:
            bbox, text, prob = item
            text_str = str(text).strip()
            # Filter trivial junk characters
            if len(text_str) == 0:
                continue

            conf_pct = round(float(prob) * 100.0, 1)
            # Normalize bounding box format: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
            box_coords = [[float(pt[0]), float(pt[1])] for pt in bbox]

            blocks.append({
                "text": text_str,
                "confidence": conf_pct,
                "box": box_coords
            })
            full_text_chunks.append(text_str)

        # Concatenate into human-readable text
        combined_text = " ".join(full_text_chunks).strip()

        if combined_text:
            narrative = f"The text reads: {combined_text}"
        else:
            narrative = "No readable text was detected. Please hold the text closer, keep it steady, and ensure sufficient lighting."

        return {
            "success": True,
            "text": combined_text,
            "blocks": blocks,
            "count": len(blocks),
            "narrative": narrative
        }

    except Exception as e:
        logger.error(f"Error during OCR reading: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Text recognition failed: {str(e)}")


class GeocodeRequest(BaseModel):
    latitude: float
    longitude: float


@app.post("/api/geocode")
async def reverse_geocode(req: GeocodeRequest):
    """
    Reverse geocode real coordinates using OpenStreetMap Nominatim.
    Produces high-accuracy address details and natural spoken location.
    """
    lat, lon = req.latitude, req.longitude
    maps_url = f"https://www.google.com/maps?q={lat},{lon}"

    try:
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {
            "lat": lat,
            "lon": lon,
            "format": "jsonv2",
            "zoom": 18,
            "addressdetails": 1
        }
        headers = {
            "User-Agent": "VisionAssist-Nayana/1.0 (accessibility-vision-assistant-ai)"
        }

        resp = requests.get(url, params=params, headers=headers, timeout=6)
        if resp.status_code == 200:
            data = resp.json()
            address = data.get("address", {})

            road = address.get("road") or address.get("pedestrian") or address.get("suburb") or ""
            neighbourhood = address.get("neighbourhood") or address.get("residential") or ""
            city = address.get("city") or address.get("town") or address.get("municipality") or address.get("village") or ""
            state = address.get("state") or address.get("state_district") or ""
            country = address.get("country") or ""
            postcode = address.get("postcode") or ""
            display_name = data.get("display_name", "")

            # Formulate spoken address
            location_components = [c for c in [road, neighbourhood, city, state] if c]
            if location_components:
                locality_str = ", ".join(location_components)
                narrative = f"You are currently near {locality_str}."
            elif display_name:
                narrative = f"You are at {display_name.split(',')[0]}."
            else:
                narrative = f"You are at latitude {round(lat, 4)} and longitude {round(lon, 4)}."

            return {
                "success": True,
                "display_name": display_name,
                "road": road,
                "neighbourhood": neighbourhood,
                "city": city,
                "state": state,
                "country": country,
                "postcode": postcode,
                "latitude": lat,
                "longitude": lon,
                "maps_url": maps_url,
                "narrative": narrative
            }

    except Exception as ex:
        logger.warning(f"Nominatim lookup failed or timed out: {ex}")

    # Fallback without fabricating
    fallback_narrative = f"Your current coordinates are latitude {round(lat, 4)} and longitude {round(lon, 4)}."
    return {
        "success": True,
        "display_name": f"Coordinates: {lat}, {lon}",
        "road": "",
        "neighbourhood": "",
        "city": "",
        "state": "",
        "country": "",
        "postcode": "",
        "latitude": lat,
        "longitude": lon,
        "maps_url": maps_url,
        "narrative": fallback_narrative
    }


# Mount frontend static files so opening http://127.0.0.1:8000 displays VisionAssist
if FRONTEND_DIR.exists():
    # Mount /static for explicit static assets
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        index_file = FRONTEND_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file, media_type="text/html")
        return {"message": "VisionAssist Backend Running. Frontend index.html not yet built."}

    # Mount root directory so relative asset requests (/style.css, /script.js, /audio_cues.js) resolve immediately
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    # Warm up YOLO model at launch
    get_yolo_model()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
