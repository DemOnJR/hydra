export function getPlatformUrl(platform) {
  switch (platform) {
    case "claude":
      return "https://claude.ai";
    case "gemini":
      return "https://gemini.google.com";
    case "chatgpt":
    default:
      return "https://chatgpt.com";
  }
}

