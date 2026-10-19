# Models

Optional local AI (`src/ai`). Fetched from this origin the first time a feature is used, then kept by the
service worker (`ai-models` runtime cache). Never precached. Run with ONNX Runtime Web 1.30.0, whose
WebAssembly the build emits from `node_modules`.

## `u2netp.onnx`

U²-Net "portable": salient object detection, used for background removal.

| | |
| --- | --- |
| Size | 2,373,690 bytes (2.4 MB) |
| Licence | Apache-2.0 |
| Paper | Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*, Pattern Recognition 106 (2020) |
| Source | https://github.com/xuebinqin/U-2-Net |
| ONNX export | https://huggingface.co/BritishWerewolf/U-2-Netp |
| Input | float32 `[1, 3, 320, 320]`, RGB, ImageNet mean/std normalised |
| Output | seven float32 `[1, 1, 320, 320]` maps; the first (fused) is used, min/max stretched |

Weights are float16 (converted with `onnxconverter_common.float16`, `keep_io_types=True`, so I/O stays
float32): half the size of the float32 export, IoU 0.97 or better against it.

**Do not quantise this to int8.** Dynamic int8 quantisation returns an empty (all black) mask and runs four
times slower: the nested RSU blocks have activation ranges too wide for per-tensor quantisation.

## `realesr-general-x4v3.onnx`

Real-ESRGAN general x4 v3 (SRVGGNetCompact): ×4 super-resolution, used for upscaling. ×2 is the ×4 result
box-halved.

| | |
| --- | --- |
| Size | 4,866,428 bytes (4.9 MB) |
| Licence | BSD-3-Clause |
| Paper | Wang et al., *Real-ESRGAN: Training Real-World Blind Super-Resolution with Pure Synthetic Data*, ICCVW 2021 |
| Source | https://github.com/xinntao/Real-ESRGAN (release v0.2.5.0, `realesr-general-x4v3.pth`) |
| ONNX export | https://huggingface.co/skillsafe-ai/realesr-general-x4v3 (`model.onnx`, float32, unaltered) |
| Input | float32 `[1, 3, H, W]`, RGB in 0..1, any size |
| Output | float32 `[1, 3, 4H, 4W]`, RGB in 0..1 |

Run in tiles (256 px on WebGPU, 192 px on the CPU, 16 px overlap) because memory grows with the picture.

## Runtime sizes

| Engine | Used for | Size |
| --- | --- | --- |
| `ort-wasm-simd-threaded.wasm` | background; upscaling without WebGPU | 14.2 MB |
| `ort-wasm-simd-threaded.asyncify.wasm` | upscaling with WebGPU | 26.8 MB |
