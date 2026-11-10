# Copyright (c) 2026, Salesforce, Inc.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Write the viewer's Salesforce connector tool name into the OM live briefing page.

Usage: python3 configure.py <page.html> <dispatch_readonly tool> <out.html>

The page ships with a placeholder connector block and makes no org calls until it holds the full, connector-prefixed name
of the one tool the artifact's mcp_tools allowlist will carry: mcp__<connector-id>__dispatch_readonly.
"""

import json
import re
import sys

PLACEHOLDER = '{"__placeholder":"OMC_TOOLS"}'
TOOL_NAME = re.compile(r"^mcp__[A-Za-z0-9_-]+__dispatch_readonly$")


def configure(page: str, tool: str) -> str:
    """Return the page with the placeholder replaced by the tool name.

    Raises:
        ValueError: the name isn't a full dispatch_readonly tool name, or the page doesn't hold exactly one placeholder.
    """
    if not TOOL_NAME.match(tool):
        raise ValueError(f"{tool!r} is not a full connector tool name like mcp__<id>__dispatch_readonly")
    count = page.count(PLACEHOLDER)
    if count != 1:
        raise ValueError(
            f"Expected one connector placeholder in the page, found {count}; "
            "configure the page from the skill's folder, not an already configured copy"
        )
    return page.replace(PLACEHOLDER, json.dumps({"dispatch_readonly": tool}))


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    _, page_path, tool, out_path = argv
    with open(page_path, encoding="utf-8") as f:
        page = f.read()
    try:
        configured = configure(page, tool)
    except ValueError as e:
        print(f"configure.py: {e}", file=sys.stderr)
        return 1
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(configured)
    print(f"Wrote {out_path} for {tool}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
