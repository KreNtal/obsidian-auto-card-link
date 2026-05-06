import { urlRegex, linkRegex, imageRegex } from "src/regex";

export class CheckIf {
  public static isUrl(text: string): boolean {
    const regex = new RegExp(urlRegex);
    return regex.test(text);
  }

  public static isImage(text: string): boolean {
    const regex = new RegExp(imageRegex);
    return regex.test(text);
  }

  public static isLinkedUrl(text: string): boolean {
    const regex = new RegExp(linkRegex);
    return regex.test(text);
  }

  public static isYouTubeUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/)/.test(url);
  }

  public static isRedditUrl(url: string): boolean {
    return /reddit\.com\/(r|u|user)\//.test(url);
  }
}
