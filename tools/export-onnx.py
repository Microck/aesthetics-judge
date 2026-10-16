"""Export facebook/audiobox-aesthetics to the int8 ONNX file the website runs.

    uv run python tools/export-onnx.py [song.wav]

Writes web/public/models/aes.int8.onnx (~126 MB). With a song argument, also
scores it with PyTorch and ONNX side by side so drift is visible.

Export notes:
- The encoder zeroes padded frames with `x[padding_mask] = 0`. ONNX traces that
  into a Where node with broken broadcasting, so it is swapped for an equivalent
  masked_fill during export only.
- No padding mask is exported. The site feeds each 10 s window at its real
  length (the last one is just shorter), which needs no mask.
- Only MatMul weights are quantized, per channel. Quantizing every layer drifts
  ~0.5 points; this keeps scores within ~0.02 of PyTorch.
"""

import inspect
import subprocess
import sys
import textwrap
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from audiobox_aesthetics.infer import initialize_predictor
from audiobox_aesthetics.model import wavlm
from onnxruntime.quantization import QuantType, quantize_dynamic

AXES = ["CE", "CU", "PC", "PQ"]
OUT = Path(__file__).parent.parent / "web" / "public" / "models"
FP32 = OUT / "aes.fp32.onnx"
INT8 = OUT / "aes.int8.onnx"

source = textwrap.dedent(inspect.getsource(wavlm.TransformerEncoder.extract_features))
source = source.replace("x[padding_mask] = 0", "x = x.masked_fill(padding_mask.unsqueeze(-1), 0)")
namespace: dict = {}
exec(source, vars(wavlm), namespace)
wavlm.TransformerEncoder.extract_features = namespace["extract_features"]

predictor = initialize_predictor()
model = predictor.model.to("cpu").eval()
predictor.device = torch.device("cpu")  # keep the comparison on the same device as the model


class Wrapper(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, wav):
        out = self.inner({"wav": wav})
        return torch.stack([out[axis] for axis in AXES], -1)


OUT.mkdir(parents=True, exist_ok=True)
example = torch.randn(1, 1, 160000) * 0.1
torch.onnx.export(Wrapper(model).eval(), (example,), str(FP32), input_names=["wav"], output_names=["out"],
                  dynamic_axes={"wav": {2: "t"}}, opset_version=17, dynamo=False)
quantize_dynamic(str(FP32), str(INT8), weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul"])
FP32.unlink()
print(f"wrote {INT8} ({INT8.stat().st_size // 2**20} MB)")

if len(sys.argv) > 1:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    pcm = np.frombuffer(raw, np.float32)
    reference = predictor.forward([{"path": torch.from_numpy(pcm.copy())[None], "sample_rate": 16000}])[0]
    session = ort.InferenceSession(str(INT8), providers=["CPUExecutionProvider"])
    mean = np.array([predictor.target_transform[a].mean for a in AXES])
    std = np.array([predictor.target_transform[a].std for a in AXES])
    windows = [pcm[i:i + 160000] for i in range(0, len(pcm), 160000)]
    weights = np.array([len(w) / 160000 for w in windows])
    preds = np.stack([session.run(None, {"wav": w[None, None]})[0][0] for w in windows]) * std + mean
    onnx_scores = (preds * weights[:, None]).sum(0) / weights.sum()
    for axis, value in zip(AXES, onnx_scores):
        print(f"{axis}: pytorch {reference[axis]:.2f}  onnx {value:.2f}")
