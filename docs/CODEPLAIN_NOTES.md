# Codeplain mechanics (researched 2026-06-20)

Practical notes for building this project with Codeplain (`plain2code.py`).
Source: Codeplain-ai example repos (`user-management-api`, `cli-password-manager`,
`plain2code_client/standard_template_library`).

## Toolchain
- Client cloned to `~/plain2code_client` (in WSL Ubuntu, root). Deps installed in
  the `~/dockenv` venv.
- Render: `python ~/plain2code_client/plain2code.py <file>.plain` with
  `CODEPLAIN_API_KEY` exported. Output goes to a `build/` dir.
- Windows: must run inside WSL.

## Templates (standard_template_library)
Only these exist:
- `python-console-app-template`
- `golang-console-app-template`
- `typescript-react-app-template`, `typescript-react-app-boilerplate`

**There is NO python REST/web template.** That's fine: a REST service is defined
from scratch with NO `import:` (see `user-management-api.plain`, which defines
`:API:` as a Node app and pins express.js via Non-Functional Requirements).

## .plain section vocabulary (full form, from user-management-api)
- `***Definitions:***` — every `:ColonTerm:` used elsewhere must be defined here.
- `***Non-Functional Requirements:***` — framework, language, run/build/test commands.
- `***Test Requirements:***` — how conformance tests run.
- `***Functional Requirements:***` — endpoints/behavior, with nested
  `***acceptance tests***` under each (hello-world uses lowercase
  `***functional specs***` / `***implementation reqs***`; both styles work).
- A project may be split across multiple `.plain` files (cli-password-manager has
  encryption.plain, key_management.plain, etc.). Start single-file; split if it grows.

## Test harness (THE important part)
- `config.yaml` declares:
  ```
  unittests-script: ./run_unittests_python.sh
  conformance-tests-script: ./run_conformance_tests_python.sh
  verbose: true
  ```
- The render machine calls:
  - unittests: `run_unittests_python.sh <build_folder>`
  - conformance: `run_conformance_tests_python.sh <build_folder> <conformance_tests_folder>`
- **Tests use Python's built-in `unittest`**, discovered via
  `python -m unittest discover` (test files named `test*.py`). NOT pytest.
- Unittests must run WITHOUT the server running (pure logic).
- **Conformance tests hit the running server over HTTP.** For a server app the
  conformance script must: build, start the app in background, `sleep`, run
  `unittest discover` on the conformance folder (tests call `http://localhost:8000`),
  and `trap cleanup EXIT` to kill the server + children. The TS
  `run_conformance_tests_jest.sh` is the reference; the Python CLI script lacks the
  server-startup part and must be extended for our Flask app.

## Implications for THIS project
- Backend = Python + Flask, defined from scratch (no template), port 8000.
- Acceptance tests = `unittest` style. Conformance tests = HTTP calls to localhost:8000.
- We author: `config.yaml`, `run_unittests_python.sh`, a server-aware
  `run_conformance_tests_python.sh`, and `plain/docking_marketplace.plain`.
- gnina is called via the `~/dockenv/bin/gninaw` wrapper (sets LD_LIBRARY_PATH).
- Fallback if Python REST renders poorly: TS/express API (proven path) shelling out
  to a Python worker (python-console-app-template) for gnina+RDKit.
