import { App, normalizePath, requestUrl } from "obsidian";

function urlHash(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = (((h << 5) + h) ^ url.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export async function downloadImage(app: App, url: string, folder: string): Promise<string | undefined> {
  try {
    const cleanUrl = url.split("?")[0] ?? url;
    let ext = cleanUrl.split(".").pop() ?? "png";
    if (ext.length > 5 || /[^a-zA-Z0-9]/.test(ext)) ext = "png";

    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const filename = `${hostname}_${urlHash(url)}.${ext}`;
    const normalizedFolder = normalizePath(folder);
    const vaultPath = normalizePath(`${normalizedFolder}/${filename}`);

    // Reuse existing file if the same URL was already downloaded
    if (await app.vault.adapter.stat(vaultPath) !== null) return vaultPath;

    const response = await requestUrl({ url, method: "GET" });
    await app.vault.adapter.mkdir(normalizedFolder).catch(() => {});
    await app.vault.adapter.writeBinary(vaultPath, response.arrayBuffer);
    return vaultPath;
  } catch (e) {
    console.error("Failed to download image:", url, e);
    return undefined;
  }
}
