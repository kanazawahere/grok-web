export interface AppUrlContext {
  viteBaseUrl: string;
  documentBaseUrl: string;
}

export function resolveAppUrl(path: string, context: AppUrlContext = browserAppUrlContext()): string {
  const applicationBaseUrl = new URL(context.viteBaseUrl, context.documentBaseUrl);
  return new URL(appRelativePath(path), applicationBaseUrl).toString();
}

export function resolveAppWebSocketUrl(path: string, context: AppUrlContext = browserAppUrlContext()): string {
  const url = new URL(resolveAppUrl(path, context));
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Cannot create a WebSocket URL from ${url.protocol}`);
  }
  return url.toString();
}

function browserAppUrlContext(): AppUrlContext {
  return {
    viteBaseUrl: import.meta.env.BASE_URL,
    documentBaseUrl: document.baseURI,
  };
}

function appRelativePath(path: string): string {
  // A leading slash means the application root, not the origin root, so it must stay within nested deployments.
  return path.startsWith("/") ? `.${path}` : path;
}
