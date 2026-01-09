#!/usr/bin/env python3
import argparse
import os
import pathlib
import zipfile


def zip_dir(src_dir: pathlib.Path, out_file: pathlib.Path) -> None:
    src_dir = src_dir.resolve()
    out_file = out_file.resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)
    if out_file.exists():
        out_file.unlink()

    with zipfile.ZipFile(out_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, dirs, files in os.walk(src_dir):
            root_path = pathlib.Path(root)
            dirs.sort()
            files.sort()
            for name in files:
                full_path = root_path / name
                rel_path = full_path.relative_to(src_dir)
                zf.write(full_path, arcname=str(rel_path))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="directory to zip")
    ap.add_argument("--out", required=True, help="output .vsix (zip) file path")
    args = ap.parse_args()

    zip_dir(pathlib.Path(args.src), pathlib.Path(args.out))


if __name__ == "__main__":
    main()
