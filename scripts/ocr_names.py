"""Read draft name and pick columns. One JSON request per line, one JSON reply."""

import base64
import io
import json
import sys
import threading
from pathlib import Path

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
import rapidocr_onnxruntime


def engine():
    root = Path(rapidocr_onnxruntime.__file__).resolve().parent
    det = root / "models" / "ch_PP-OCRv3_det_infer.onnx"
    # The short side is grown until names like Huckit stay Huckit.
    # A shorter limit reads that name as Hucklt. Slicing a column into
    # five plates drops the first letter of Tyrael, so each column stays one image.
    return RapidOCR(
        min_height=6,
        text_score=0.3,
        use_angle_cls=False,
        det_model_path=str(det),
        det_limit_side_len=2200,
        det_limit_type="min",
        det_box_thresh=0.3,
        det_thresh=0.2,
    )


LEFT_READER = engine()
RIGHT_READER = engine()
CENTER_READER = engine()
# Nameplates and the center splash use different engines, so a splash read
# does not hold the next lock behind it.
NAME_LOCK = threading.Lock()
CENTER_LOCK = threading.Lock()
WRITE_LOCK = threading.Lock()


def decode_image(raw: str):
    if not raw:
        return None
    image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
    return np.asarray(image)


def lines_from(reader: RapidOCR, image):
    if image is None:
        return []
    try:
        result, _ = reader(image)
    except Exception:
        return []
    lines = []
    for item in result or []:
        text = str(item[1])
        if not any(("A" <= char <= "Z") or ("a" <= char <= "z") for char in text):
            continue
        top = min(point[1] for point in item[0])
        left = min(point[0] for point in item[0])
        lines.append({
            "text": text,
            "top": float(top),
            "x": float(left),
            "score": float(item[2]),
        })
    lines.sort(key=lambda line: line["top"])
    return lines


def write_reply(reply: dict) -> None:
    with WRITE_LOCK:
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


def handle(request: dict) -> None:
    request_id = request.get("id")
    try:
        left_image = decode_image(request.get("left") or "")
        right_image = decode_image(request.get("right") or "")
        center_image = decode_image(request.get("center") or "")
        picks_left = decode_image(request.get("picksLeft") or "")
        picks_right = decode_image(request.get("picksRight") or "")
        names: dict[str, list] = {}
        splash: dict[str, list] = {}

        def read_names() -> None:
            with NAME_LOCK:
                left_thread = threading.Thread(
                    target=lambda: names.__setitem__("left", lines_from(LEFT_READER, left_image)),
                )
                right_thread = threading.Thread(
                    target=lambda: names.__setitem__("right", lines_from(RIGHT_READER, right_image)),
                )
                left_thread.start()
                right_thread.start()
                left_thread.join()
                right_thread.join()
                names["picksLeft"] = lines_from(LEFT_READER, picks_left)
                names["picksRight"] = lines_from(RIGHT_READER, picks_right)

        def read_splash() -> None:
            with CENTER_LOCK:
                splash["center"] = lines_from(CENTER_READER, center_image)

        name_thread = threading.Thread(target=read_names)
        splash_thread = threading.Thread(target=read_splash)
        name_thread.start()
        splash_thread.start()
        name_thread.join()
        splash_thread.join()
        write_reply({
            "id": request_id,
            "left": names.get("left", []),
            "right": names.get("right", []),
            "picksLeft": names.get("picksLeft", []),
            "picksRight": names.get("picksRight", []),
            "center": splash.get("center", []),
        })
    except Exception as error:  # noqa: BLE001 - the node side needs the message
        write_reply({"id": request_id, "left": [], "right": [], "error": str(error)})


def main():
    sys.stdout.reconfigure(line_buffering=True)
    inflight: list[threading.Thread] = []
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            request = json.loads(raw_line)
        except Exception as error:  # noqa: BLE001
            write_reply({"id": None, "left": [], "right": [], "error": str(error)})
            continue
        thread = threading.Thread(target=handle, args=(request,))
        thread.start()
        inflight.append(thread)
    for thread in inflight:
        thread.join()


if __name__ == "__main__":
    main()
