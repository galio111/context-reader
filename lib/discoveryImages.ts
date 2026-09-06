import { remotePublicImageDimensions } from "@/lib/publicArticleCovers";

export async function discoveryImageIsReadable(url: string, sourceUrl = ""): Promise<boolean> {
  try {
    const metadata = await remotePublicImageDimensions(url, sourceUrl);
    return metadata.width >= 300 && metadata.height >= 150;
  } catch { return false; }
}
