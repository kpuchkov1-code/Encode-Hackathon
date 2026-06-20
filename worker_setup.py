"""Self-bootstrapping environment setup for the docking worker daemon.

Run automatically by worker_daemon.py on startup so a fresh machine -- the actual
target of the idle-compute pitch -- needs nothing pre-installed beyond Python 3 and
internet access: no manual gnina download, no manually-managed LD_LIBRARY_PATH, no
separate wrapper script. Installs the Python deps, downloads the gnina binary, and
resolves the dynamic-library environment gnina needs at call time (real GPU drivers if
present, otherwise the pip-installed nvidia-*-cu12 wheels purely for their .so files --
see SESSION_HANDOFF.md for how this was discovered the hard way).
"""
import importlib.util
import os
import subprocess
import sys
import urllib.request

WORKER_HOME = os.path.expanduser(os.environ.get("WORKER_HOME", "~/.docking-worker"))
GNINA_PATH = os.path.join(WORKER_HOME, "bin", "gnina")
GNINA_VERSION = "1.3.2"
GNINA_URL = f"https://github.com/gnina/gnina/releases/download/v{GNINA_VERSION}/gnina.{GNINA_VERSION}"

# Pinned versions confirmed working for gnina's dynamic-link requirements on CPU-only
# Linux hosts (see SESSION_HANDOFF.md "Native Linux environment").
GPU_LIB_PACKAGES = [
    "nvidia-cublas-cu12==12.9.2.10",
    "nvidia-cuda-nvrtc-cu12==12.9.86",
    "nvidia-cuda-runtime-cu12==12.9.79",
    "nvidia-cudnn-cu12==9.23.2.1",
    "nvidia-cufft-cu12==11.4.1.4",
    "nvidia-cusolver-cu12==11.7.5.82",
    "nvidia-cusparse-cu12==12.5.10.65",
    "nvidia-nvjitlink-cu12==12.9.86",
    "nvidia-nvtx-cu12==12.9.79",
    "nvidia-nvtx-cu11==11.8.86",  # ships libnvToolsExt.so.1, which gnina needs; cu12's
                                  # nvtx package only ships libnvtx3interop.so.1, not this
]


def has_gpu() -> bool:
    try:
        subprocess.run(["nvidia-smi"], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def _pip_install(*packages: str) -> None:
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", *packages]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and "externally-managed-environment" in result.stderr:
        # Debian/Ubuntu's PEP 668 guard; fine to override on a single-purpose worker box.
        result = subprocess.run([*cmd, "--break-system-packages"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pip install failed for {packages}: {result.stderr.strip()}")


def ensure_python_packages() -> None:
    try:
        import rdkit  # noqa: F401
        import requests  # noqa: F401
    except ImportError:
        _pip_install("requests==2.32.3", "rdkit==2024.3.5", "numpy<2")

    if not has_gpu() and importlib.util.find_spec("nvidia") is None:
        _pip_install(*GPU_LIB_PACKAGES)


def ensure_gnina_binary() -> str:
    os.makedirs(os.path.dirname(GNINA_PATH), exist_ok=True)
    if not os.path.exists(GNINA_PATH):
        print(f"worker setup: downloading gnina v{GNINA_VERSION} (~1.4GB, one-time)...", file=sys.stderr)
        urllib.request.urlretrieve(GNINA_URL, GNINA_PATH)
        os.chmod(GNINA_PATH, 0o755)
    return GNINA_PATH


def _nvidia_lib_dirs() -> list[str]:
    spec = importlib.util.find_spec("nvidia")
    if spec is None or not spec.submodule_search_locations:
        return []
    nvidia_root = list(spec.submodule_search_locations)[0]
    dirs = []
    for name in sorted(os.listdir(nvidia_root)):
        lib_dir = os.path.join(nvidia_root, name, "lib")
        if os.path.isdir(lib_dir):
            dirs.append(lib_dir)
    return dirs


def get_gnina_env() -> dict:
    """Subprocess environment gnina needs to find its shared libraries.

    On a real GPU machine, the system's own CUDA/driver install is assumed already on
    the loader's search path (the normal case once drivers are installed) -- nothing
    extra is added. On CPU-only hosts, gnina still dynamically links CUDA/cuDNN symbols
    it never calls, so LD_LIBRARY_PATH is pointed at the pip-installed nvidia-*-cu12
    wheels' .so files instead.
    """
    env = os.environ.copy()
    if not has_gpu():
        lib_dirs = _nvidia_lib_dirs()
        existing = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = ":".join(lib_dirs + ([existing] if existing else []))
    return env


def run_setup() -> str:
    """Ensures the full toolchain is ready; returns the gnina binary path to invoke."""
    print("worker setup: checking Python packages...", file=sys.stderr)
    ensure_python_packages()
    print("worker setup: checking gnina binary...", file=sys.stderr)
    gnina_path = ensure_gnina_binary()
    print("worker setup: verifying gnina runs...", file=sys.stderr)
    result = subprocess.run([gnina_path, "--version"], env=get_gnina_env(), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"gnina --version failed after setup: {result.stderr.strip()}")
    print(f"worker setup: ready ({result.stdout.strip()})", file=sys.stderr)
    return gnina_path
