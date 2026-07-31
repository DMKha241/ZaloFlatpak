#!/usr/bin/env python3
"""Prepend the release from RELEASE_TAG to the Flatpak metainfo file."""

import os
import re
import sys
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr


METainfo = Path("flatpak/io.github.DMKha241.ZaloFlatpak.metainfo.xml")


def main() -> None:
    version = os.environ.get("RELEASE_TAG", "").strip()
    if not version:
        sys.exit("RELEASE_TAG must be set.")

    contents = METainfo.read_text(encoding="utf-8")
    if re.search(rf"<release\s+version={re.escape(quoteattr(version))}", contents):
        print(f"Release {version} already exists; nothing to do.")
        return

    release = (
        f'        <release version={quoteattr(version)} date="{date.today().isoformat()}">\n'
        "            <description>\n"
        f"                <p>Update to {escape(version)}</p>\n"
        "            </description>\n"
        "        </release>\n"
    )
    updated, count = re.subn(
        r"(?m)^(\s*</releases>)$", release + r"\1", contents, count=1
    )
    if count != 1:
        sys.exit(f"Could not find <releases> closing tag in {METainfo}.")

    METainfo.write_text(updated, encoding="utf-8")
    print(f"Added release {version}.")


if __name__ == "__main__":
    main()
