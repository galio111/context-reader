export function scopeReaderTokenId(scope: string, tokenId: string): string {
  return scope ? `${scope}${tokenId}` : tokenId;
}
