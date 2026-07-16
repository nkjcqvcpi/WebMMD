// SPDX-License-Identifier: AGPL-3.0-or-later

export function resolveRelativePath(
  basePath: string,
  relativePath: string,
): string {
  const base = basePath.replace(/\\/g, "/").toLowerCase();
  const rel = relativePath.replace(/\\/g, "/").toLowerCase();

  if (rel.startsWith("/") || rel.includes(":/")) {
    return collapseSegments(rel);
  }

  const lastSlash = base.lastIndexOf("/");
  const dir = lastSlash >= 0 ? base.substring(0, lastSlash + 1) : "";

  return collapseSegments(dir + rel);
}

export function collapseSegments(path: string): string {
  const parts = path.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else {
        stack.push("..");
      }
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}
