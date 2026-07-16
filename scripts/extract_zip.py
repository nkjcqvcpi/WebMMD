# SPDX-License-Identifier: GPL-3.0-or-later
import os
import sys
import zipfile

def main():
    zip_path = os.path.join("ref", "test.zip")
    output_dir = os.path.join(".tests-local", "extracted")

    if not os.path.exists(zip_path):
        print(f"Error: {zip_path} not found")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    print(f"Extracting {zip_path} using Python zipfile to {output_dir}...")
    
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        for member in zip_ref.infolist():
            # MMD ZIP files are usually encoded in CP932 (Shift-JIS)
            filename = member.filename
            try:
                # Try decoding as cp932 (Japanese Windows)
                filename = member.filename.encode('cp437').decode('cp932')
            except Exception:
                try:
                    # Fallback to utf-8
                    filename = member.filename.encode('utf-8').decode('utf-8')
                except Exception:
                    # Keep original string if all else fails
                    pass

            # Normalize backslashes to forward slashes
            filename = filename.replace('\\', '/')
            
            # Clean path to prevent Zip Slip vulnerability
            parts = filename.split('/')
            clean_parts = []
            for part in parts:
                if part == '..' or part == '.' or not part:
                    continue
                clean_parts.append(part)
            
            if not clean_parts:
                continue
                
            clean_filename = "/".join(clean_parts)
            target_path = os.path.join(output_dir, clean_filename)

            # If it's a directory
            if member.is_dir() or filename.endswith('/'):
                os.makedirs(target_path, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with zip_ref.open(member) as source, open(target_path, "wb") as target:
                    target.write(source.read())

    print("Python extraction finished successfully.")

if __name__ == "__main__":
    main()
