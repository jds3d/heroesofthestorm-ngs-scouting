"""Read draft name and pick columns. One JSON request per line, one JSON reply."""

import base64
import io
import json
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR
import rapidocr_onnxruntime


def engine():
    root = Path(rapidocr_onnxruntime.__file__).resolve().parent
    det = root / "models" / "ch_PP-OCRv3_det_infer.onnx"
    # The default detector shrinks the picture until short names disappear.
    return RapidOCR(
        min_height=6,
        text_score=0.3,
        use_angle_cls=False,
        det_model_path=str(det),
        det_limit_side_len=2200,
        det_box_thresh=0.3,
        det_thresh=0.2,
    )


# Separate models so the name columns and the pick columns can run together.
NAME_READER = engine()
PICK_READER = engine()
POOL = ThreadPoolExecutor(max_workers=2)


def lines_from(reader: RapidOCR, raw: str):
    if not raw:
        return []
    image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
        image.save(handle.name)
        path = handle.name
    try:
        result, _ = reader(path)
    finally:
        Path(path).unlink(missing_ok=True)
    lines = []
    for item in result or []:
        text = str(item[1])
        if not any(("A" <= char <= "Z") or ("a" <= char <= "z") for char in text):
            continue
        top = min(point[1] for point in item[0])
        lines.append({"text": text, "top": float(top), "score": float(item[2])})
    lines.sort(key=lambda line: line["top"])
    return lines


def column_pair(reader: RapidOCR, left: str, right: str):
    try:
        return lines_from(reader, left), lines_from(reader, right)
    except Exception:
        return [], []


def main():
    sys.stdout.reconfigure(line_buffering=True)
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            names = POOL.submit(
                column_pair,
                NAME_READER,
                request.get("left") or "",
                request.get("right") or "",
            )
            picks = POOL.submit(
                column_pair,
                PICK_READER,
                request.get("picksLeft") or "",
                request.get("picksRight") or "",
            )
            left, right = names.result()
            picks_left, picks_right = picks.result()
            # After the pair finishes, so this does not share a reader with them.
            center = lines_from(NAME_READER, request.get("center") or "")
            reply = {
                "id": request_id,
                "left": left,
                "right": right,
                "picksLeft": picks_left,
                "picksRight": picks_right,
                "center": center,
            }
        except Exception as error:  # noqa: BLE001 - the node side needs the message
            reply = {"id": request_id, "left": [], "right": [], "error": str(error)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
