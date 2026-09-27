export function generateCoverVariants(bytes: Uint8Array): Promise<{
  width: number; height: number;
  items: Array<{ bytes: Buffer; width: number; height: number }>;
}>;
