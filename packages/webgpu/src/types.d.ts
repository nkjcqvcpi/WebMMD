// SPDX-License-Identifier: GPL-3.0-or-later

declare module "*.wgsl?raw" {
  const content: string;
  export default content;
}

declare module "*.wgsl" {
  const content: string;
  export default content;
}
