# Lightweight AutoDock Vina test engine image -- a fast stand-in for the full gnina
# engine (see ../Dockerfile, ../gnina-bin/) while that one is built/tested separately.
# No CUDA/cuDNN libraries needed at all (Vina has no GPU/CNN scoring), so this builds
# in a couple of minutes instead of the gnina image's much larger dependency set.
#
# Build from the repo root (needs access to docking_worker.py):
#   docker build -f vina-test/Dockerfile -t docking-engine-vina:latest .
FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libboost-dev \
    libboost-python-dev \
    libboost-thread-dev \
    libboost-filesystem-dev \
    libboost-program-options-dev \
    libboost-serialization-dev \
    swig \
    && rm -rf /var/lib/apt/lists/*

# The `vina` PyPI package compiles against Boost at install time. Debian's current
# libboost-dev removed the deprecated boost::timer header vina 1.2.5 still uses --
# BOOST_TIMER_ENABLE_DEPRECATED re-enables it (see SESSION_HANDOFF.md).
ENV CXXFLAGS="-DBOOST_TIMER_ENABLE_DEPRECATED"
RUN pip install --no-cache-dir vina==1.2.5 meeko==0.6.1 rdkit==2024.3.5 "numpy<2"

WORKDIR /app
COPY docking_worker.py docking_worker_vina.py engine_entrypoint_vina.py worker_setup.py ./

ENTRYPOINT ["python", "engine_entrypoint_vina.py"]
