export function setDocumentHead(title, iconHref) {
  if (typeof document === "undefined") return;

  document.title = title;

  let favicon = document.querySelector("link[rel='icon']");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.setAttribute("rel", "icon");
    document.head.appendChild(favicon);
  }

  favicon.setAttribute("type", "image/svg+xml");
  favicon.setAttribute("href", iconHref);
}
