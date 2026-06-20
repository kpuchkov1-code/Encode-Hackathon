# Engine image: the per-job execution unit. The orchestrator (worker_daemon.py, runs
# directly on the host, NOT in a container) spins up one of these per claimed job via
# `docker run`, mounting a job dir at /job containing job_spec.json and reads back
# result.json -- see engine_entrypoint.py. Nothing about gnina/RDKit/CUDA-compat
# libraries ever touches the host directly; it's all sealed in this image. A real GPU is
# used automatically when the container is run with `--gpus all` (the orchestrator
# decides this once per host, not per job); otherwise gnina runs CPU-only via the same
# image -- see worker_setup.py for the detection logic either way.
FROM python:3.11-slim

WORKDIR /app
ENV WORKER_HOME=/root/.docking-worker

# gnina is COPYed from a locally pre-downloaded binary (gnina-bin/, gitignored -- run
# `python -c "import worker_setup; worker_setup.ensure_gnina_binary()"` once locally to
# fetch it) rather than downloaded during the build. This is its own cache layer, placed
# before the pip install steps below specifically so that changing the dependency list
# later never invalidates this layer's cache and triggers a ~1.4GB re-download.
COPY gnina-bin/gnina /root/.docking-worker/bin/gnina
RUN chmod +x /root/.docking-worker/bin/gnina

COPY requirements-worker.txt .
RUN pip install --no-cache-dir -r requirements-worker.txt

# CPU-fallback dynamic libraries gnina needs even when not using a GPU (see
# worker_setup.py / SESSION_HANDOFF.md "Native Linux environment" for why). Baked in
# unconditionally at build time -- a build sandbox has no GPU to detect anyway, and this
# keeps the image working immediately on CPU-only hosts too. Keep this list in sync with
# worker_setup.GPU_LIB_PACKAGES -- it's duplicated here only because Docker layer caching
# needs it as a literal RUN command, not a Python call (see lesson in SESSION_HANDOFF.md:
# this list silently drifting out of sync with worker_setup.py was a real, costly bug).
RUN pip install --no-cache-dir \
    nvidia-cublas-cu12==12.9.2.10 \
    nvidia-cuda-nvrtc-cu12==12.9.86 \
    nvidia-cuda-runtime-cu12==12.9.79 \
    nvidia-cudnn-cu12==9.23.2.1 \
    nvidia-cufft-cu12==11.4.1.4 \
    nvidia-cusolver-cu12==11.7.5.82 \
    nvidia-cusparse-cu12==12.5.10.65 \
    nvidia-nvjitlink-cu12==12.9.86 \
    nvidia-nvtx-cu12==12.9.79 \
    nvidia-nvtx-cu11==11.8.86

COPY docking_worker.py worker_setup.py engine_entrypoint.py ./

ENTRYPOINT ["python", "engine_entrypoint.py"]
